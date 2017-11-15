"use strict";

var EventEmitter = require("events").EventEmitter;

var Exception = require("./util").Exception;

var log = require("./log");

var rtc = require("./rtc");

var RTCMonitor = require("./rtc/monitor");

var twutil = require("./util");

var util = require("util");

var DTMF_INTER_TONE_GAP = 70;

var DTMF_PAUSE_DURATION = 500;

var DTMF_TONE_DURATION = 160;

var METRICS_BATCH_SIZE = 10;

var SAMPLES_TO_IGNORE = 20;

var FEEDBACK_SCORES = [ 1, 2, 3, 4, 5 ];

var FEEDBACK_ISSUES = [ "one-way-audio", "choppy-audio", "dropped-call", "audio-latency", "noisy-call", "echo" ];

var WARNING_NAMES = {
        audioOutputLevel: "audio-output-level",
        audioInputLevel: "audio-input-level",
        packetsLostFraction: "packet-loss",
        jitter: "jitter",
        rtt: "rtt",
        mos: "mos"
    };

var WARNING_PREFIXES = {
        min: "low-",
        max: "high-",
        maxDuration: "constant-"
    };

function Connection(device, message, getUserMedia, options) {
    if (!(this instanceof Connection)) {
        return new Connection(device, message, getUserMedia, options);
    }
    var self = this;
    twutil.monitorEventEmitter("Twilio.Connection", this);
    this.device = device;
    this.message = message || {};
    var DefaultMediaStream = options.mediaStreamFactory || device.options.MediaStream || device.options.mediaStreamFactory || rtc.PeerConnection;
    options = this.options = Object.assign({
        audioConstraints: device.options.audioConstraints,
        callParameters: {},
        debug: false,
        encrypt: false,
        iceServers: device.options.iceServers,
        logPrefix: "[Connection]",
        MediaStream: DefaultMediaStream,
        offerSdp: null,
        rtcConstraints: device.options.rtcConstraints
    }, options);
    this.parameters = options.callParameters;
    this._status = "pending";
    this._direction = this.parameters.CallSid ? "INCOMING" : "OUTGOING";
    this.sendHangup = true;
    log.mixinLog(this, this.options.logPrefix);
    this.log.enabled = this.options.debug;
    this.log.warnings = this.options.warnings;
    function noop() {}
    this._onCancel = noop;
    this._onHangup = noop;
    this._onAnswer = function(payload) {
        if (typeof payload.callsid !== "undefined") {
            self.parameters.CallSid = payload.callsid;
            self.mediaStream.callSid = payload.callsid;
        }
    };
    var publisher = this._publisher = options.publisher;
    if (this._direction === "INCOMING") {
        publisher.info("connection", "incoming", null, this);
    }
    var monitor = this._monitor = new RTCMonitor();
    monitor.disableWarnings();
    var samples = [];
    function createMetricPayload() {
        var payload = {
                call_sid: self.parameters.CallSid,
                client_name: device._clientName,
                sdk_version: twutil.getReleaseVersion(),
                selected_region: device.options.region
            };
        if (device.stream) {
            if (device.stream.gateway) {
                payload.gateway = device.stream.gateway;
            }
            if (device.stream.region) {
                payload.region = device.stream.region;
            }
        }
        payload.direction = self._direction;
        return payload;
    }
    function publishMetrics() {
        if (samples.length === 0) {
            return;
        }
        publisher.postMetrics("quality-metrics-samples", "metrics-sample", samples.splice(0), createMetricPayload());
    }
    var samplesIgnored = 0;
    monitor.on("sample", function(sample) {
        if (samplesIgnored < SAMPLES_TO_IGNORE) {
            samplesIgnored++;
        } else if (samplesIgnored === SAMPLES_TO_IGNORE) {
            monitor.enableWarnings();
        }
        sample.inputVolume = self._latestInputVolume;
        sample.outputVolume = self._latestOutputVolume;
        samples.push(sample);
        if (samples.length >= METRICS_BATCH_SIZE) {
            publishMetrics();
        }
    });
    function formatPayloadForEA(warningData) {
        var payloadData = {
                threshold: warningData.threshold.value
            };
        if (warningData.values) {
            payloadData.values = warningData.values.map(function(value) {
                if (typeof value === "number") {
                    return Math.round(value * 100) / 100;
                }
                return value;
            });
        } else if (warningData.value) {
            payloadData.value = warningData.value;
        }
        return {
            data: payloadData
        };
    }
    function reemitWarning(wasCleared, warningData) {
        var groupPrefix = /^audio/.test(warningData.name) ? "audio-level-" : "network-quality-";
        var groupSuffix = wasCleared ? "-cleared" : "-raised";
        var groupName = groupPrefix + "warning" + groupSuffix;
        var warningPrefix = WARNING_PREFIXES[warningData.threshold.name];
        var warningName = warningPrefix + WARNING_NAMES[warningData.name];
        if (warningName === "constant-audio-input-level" && self.isMuted()) {
            return;
        }
        var level = wasCleared ? "info" : "warning";
        if (warningName === "constant-audio-output-level") {
            level = "info";
        }
        publisher.post(level, groupName, warningName, formatPayloadForEA(warningData), self);
        if (warningName !== "constant-audio-output-level") {
            var emitName = wasCleared ? "warning-cleared" : "warning";
            self.emit(emitName, warningName);
        }
    }
    monitor.on("warning-cleared", reemitWarning.bind(null, true));
    monitor.on("warning", reemitWarning.bind(null, false));
    this.mediaStream = new this.options.MediaStream(this.device, getUserMedia);
    this.on("volume", function(inputVolume, outputVolume) {
        self._latestInputVolume = inputVolume;
        self._latestOutputVolume = outputVolume;
    });
    this.mediaStream.onvolume = this.emit.bind(this, "volume");
    this.mediaStream.oniceconnectionstatechange = function(state) {
        var level = state === "failed" ? "error" : "debug";
        publisher.post(level, "ice-connection-state", state, null, self);
    };
    this.mediaStream.onicegatheringstatechange = function(state) {
        publisher.debug("signaling-state", state, null, self);
    };
    this.mediaStream.onsignalingstatechange = function(state) {
        publisher.debug("signaling-state", state, null, self);
    };
    this.mediaStream.ondisconnect = function(msg) {
        self.log(msg);
        publisher.warn("network-quality-warning-raised", "ice-connectivity-lost", {
            message: msg
        }, self);
        self.emit("warning", "ice-connectivity-lost");
    };
    this.mediaStream.onreconnect = function(msg) {
        self.log(msg);
        publisher.info("network-quality-warning-cleared", "ice-connectivity-lost", {
            message: msg
        }, self);
        self.emit("warning-cleared", "ice-connectivity-lost");
    };
    this.mediaStream.onerror = function(e) {
        if (e.disconnect === true) {
            self._disconnect(e.info && e.info.message);
        }
        var error = {
                code: e.info.code,
                message: e.info.message || "Error with mediastream",
                info: e.info,
                connection: self
            };
        self.log("Received an error from MediaStream:", e);
        self.emit("error", error);
    };
    this.mediaStream.onopen = function() {
        if (self._status === "open") {
            return;
        } else if (self._status === "connecting") {
            self._status = "open";
            self.mute(false);
            self.emit("accept", self);
        } else {
            self.mediaStream.close();
        }
    };
    this.mediaStream.onclose = function() {
        self._status = "closed";
        if (self.device.sounds.__dict__.disconnect) {
            self.device.soundcache.get("disconnect").play();
        }
        monitor.disable();
        publishMetrics();
        self.emit("disconnect", self);
    };
    this.outboundConnectionId = twutil.generateConnectionUUID();
    this.pstream = this.device.stream;
    this._onCancel = function(payload) {
        var callsid = payload.callsid;
        if (self.parameters.CallSid === callsid) {
            self._status = "closed";
            self.emit("cancel");
            self.pstream.removeListener("cancel", self._onCancel);
        }
    };
    if (this.pstream) {
        this.pstream.addListener("cancel", this._onCancel);
    }
    this.on("error", function(error) {
        publisher.error("connection", "error", {
            code: error.code,
            message: error.message
        }, self);
        if (self.pstream && self.pstream.status === "disconnected") {
            cleanupEventListeners(self);
        }
    });
    this.on("disconnect", function() {
        cleanupEventListeners(self);
    });
    return this;
}

util.inherits(Connection, EventEmitter);

Connection.toString = function() {
    return "[Twilio.Connection class]";
};

Connection.prototype.toString = function() {
    return "[Twilio.Connection instance]";
};

Connection.prototype.sendDigits = function(digits) {
    if (digits.match(/[^0-9*#w]/)) {
        throw new Exception("Illegal character passed into sendDigits");
    }
    var sequence = [];
    digits.split("").forEach(function(digit) {
        var dtmf = digit !== "w" ? "dtmf" + digit : "";
        if (dtmf === "dtmf*") {
            dtmf = "dtmfs";
        }
        if (dtmf === "dtmf#") {
            dtmf = "dtmfh";
        }
        sequence.push(dtmf);
    });
    (function playNextDigit(soundCache) {
        var digit = sequence.shift();
        soundCache.get(digit).play();
        if (sequence.length) {
            setTimeout(playNextDigit.bind(null, soundCache), 200);
        }
    })(this.device.soundcache);
    var dtmfSender = this.mediaStream.getOrCreateDTMFSender();
    function insertDTMF(dtmfs) {
        if (!dtmfs.length) {
            return;
        }
        var dtmf = dtmfs.shift();
        if (dtmf.length) {
            dtmfSender.insertDTMF(dtmf, DTMF_TONE_DURATION, DTMF_INTER_TONE_GAP);
        }
        setTimeout(insertDTMF.bind(null, dtmfs), DTMF_PAUSE_DURATION);
    }
    if (dtmfSender) {
        if (!("canInsertDTMF" in dtmfSender) || dtmfSender.canInsertDTMF) {
            this.log("Sending digits using RTCDTMFSender");
            insertDTMF(digits.split("w"));
            return;
        }
        this.log("RTCDTMFSender cannot insert DTMF");
    }
    this.log("Sending digits over PStream");
    var payload;
    if (this.pstream !== null && this.pstream.status !== "disconnected") {
        payload = {
            dtmf: digits,
            callsid: this.parameters.CallSid
        };
        this.pstream.publish("dtmf", payload);
    } else {
        payload = {
            error: {}
        };
        var error = {
                code: payload.error.code || 31e3,
                message: payload.error.message || "Could not send DTMF: Signaling channel is disconnected",
                connection: this
            };
        this.emit("error", error);
    }
};

Connection.prototype.status = function() {
    return this._status;
};

Connection.prototype.mute = function(shouldMute) {
    if (typeof shouldMute === "undefined") {
        shouldMute = true;
        this.log.deprecated(".mute() is deprecated. Please use .mute(true) or .mute(false) " + "to mute or unmute a call instead.");
    } else if (typeof shouldMute === "function") {
        this.addListener("mute", shouldMute);
        return;
    }
    if (this.isMuted() === shouldMute) {
        return;
    }
    this.mediaStream.mute(shouldMute);
    var isMuted = this.isMuted();
    this._publisher.info("connection", isMuted ? "muted" : "unmuted", null, this);
    this.emit("mute", isMuted, this);
};

Connection.prototype.isMuted = function() {
    return this.mediaStream.isMuted;
};

Connection.prototype.unmute = function() {
    this.log.deprecated(".unmute() is deprecated. Please use .mute(false) to unmute a call instead.");
    this.mute(false);
};

Connection.prototype.accept = function(handler) {
    if (typeof handler === "function") {
        this.addListener("accept", handler);
        return;
    }
    if (this._status !== "pending") {
        return;
    }
    var audioConstraints = handler || this.options.audioConstraints;
    var self = this;
    this._status = "connecting";
    function connect_() {
        if (self._status !== "connecting") {
            cleanupEventListeners(self);
            self.mediaStream.close();
            return;
        }
        var pairs = [];
        for (var key in self.message) {
            pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(self.message[key]));
        }
        function onLocalAnswer(pc) {
            self._publisher.info("connection", "accepted-by-local", null, self);
            self._monitor.enable(pc);
        }
        function onRemoteAnswer(pc) {
            self._publisher.info("connection", "accepted-by-remote", null, self);
            self._monitor.enable(pc);
        }
        var sinkIds = typeof self.options.getSinkIds === "function" && self.options.getSinkIds();
        if (Array.isArray(sinkIds)) {
            self.mediaStream._setSinkIds(sinkIds).catch(function() {});
        }
        var params = pairs.join("&");
        if (self._direction === "INCOMING") {
            self.mediaStream.answerIncomingCall(self.parameters.CallSid, self.options.offerSdp, self.options.rtcConstraints, self.options.iceServers, onLocalAnswer);
        } else {
            self.pstream.once("answer", self._onAnswer);
            self.mediaStream.makeOutgoingCall(params, self.outboundConnectionId, self.options.rtcConstraints, self.options.iceServers, onRemoteAnswer);
        }
        self._onHangup = function(payload) {
            if (payload.callsid && (self.parameters.CallSid || self.outboundConnectionId)) {
                if (payload.callsid !== self.parameters.CallSid && payload.callsid !== self.outboundConnectionId) {
                    return;
                }
            } else if (payload.callsid) {
                return;
            }
            self.log("Received HANGUP from gateway");
            if (payload.error) {
                var error = {
                        code: payload.error.code || 31e3,
                        message: payload.error.message || "Error sent from gateway in HANGUP",
                        connection: self
                    };
                self.log("Received an error from the gateway:", error);
                self.emit("error", error);
            }
            self.sendHangup = false;
            self._publisher.info("connection", "disconnected-by-remote", null, self);
            self._disconnect(null, true);
            cleanupEventListeners(self);
        };
        self.pstream.addListener("hangup", self._onHangup);
    }
    var inputStream = typeof this.options.getInputStream === "function" && this.options.getInputStream();
    var promise = inputStream ? this.mediaStream.openWithStream(inputStream) : this.mediaStream.openWithConstraints(audioConstraints);
    promise.then(function() {
        self._publisher.info("get-user-media", "succeeded", {
            data: {
                audioConstraints: audioConstraints
            }
        }, self);
        connect_();
    }, function(error) {
        var message;
        var code;
        if (error.code && error.code === error.PERMISSION_DENIED || error.name && error.name === "PermissionDeniedError") {
            code = 31208;
            message = "User denied access to microphone, or the web browser did not allow microphone " + "access at this address.";
            self._publisher.error("get-user-media", "denied", {
                data: {
                    audioConstraints: audioConstraints,
                    error: error
                }
            }, self);
        } else {
            code = 31201;
            message = "Error occurred while accessing microphone: " + error.name + (error.message ? " (" + error.message + ")" : "");
            self._publisher.error("get-user-media", "failed", {
                data: {
                    audioConstraints: audioConstraints,
                    error: error
                }
            }, self);
        }
        return self._die(message, code);
    });
};

Connection.prototype.reject = function(handler) {
    if (typeof handler === "function") {
        this.addListener("reject", handler);
        return;
    }
    if (this._status !== "pending") {
        return;
    }
    var payload = {
            callsid: this.parameters.CallSid
        };
    this.pstream.publish("reject", payload);
    this.emit("reject");
    this.mediaStream.reject(this.parameters.CallSid);
    this._publisher.info("connection", "rejected-by-local", null, this);
};

Connection.prototype.ignore = function(handler) {
    if (typeof handler === "function") {
        this.addListener("cancel", handler);
        return;
    }
    if (this._status !== "pending") {
        return;
    }
    this._status = "closed";
    this.emit("cancel");
    this.mediaStream.ignore(this.parameters.CallSid);
    this._publisher.info("connection", "ignored-by-local", null, this);
};

Connection.prototype.cancel = function(handler) {
    this.log.deprecated(".cancel() is deprecated. Please use .ignore() instead.");
    this.ignore(handler);
};

Connection.prototype.disconnect = function(handler) {
    if (typeof handler === "function") {
        this.addListener("disconnect", handler);
        return;
    }
    this._disconnect();
};

Connection.prototype._disconnect = function(message, remote) {
    message = typeof message === "string" ? message : null;
    if (this._status !== "open" && this._status !== "connecting") {
        return;
    }
    this.log("Disconnecting...");
    if (this.pstream !== null && this.pstream.status !== "disconnected" && this.sendHangup) {
        var callId = this.parameters.CallSid || this.outboundConnectionId;
        if (callId) {
            var payload = {
                    callsid: callId
                };
            if (message) {
                payload.message = message;
            }
            this.pstream.publish("hangup", payload);
        }
    }
    cleanupEventListeners(this);
    this.mediaStream.close();
    if (!remote) {
        this._publisher.info("connection", "disconnected-by-local", null, this);
    }
};

Connection.prototype.error = function(handler) {
    if (typeof handler === "function") {
        this.addListener("error", handler);
        return;
    }
};

Connection.prototype._die = function(message, code) {
    this._disconnect();
    this.emit("error", {
        message: message,
        code: code
    });
};

Connection.prototype._setSinkIds = function _setSinkIds(sinkIds) {
    return this.mediaStream._setSinkIds(sinkIds);
};

Connection.prototype._setInputTracksFromStream = function _setInputTracksFromStream(stream) {
    return this.mediaStream.setInputTracksFromStream(stream);
};

Connection.prototype.volume = function(handler) {
    if (!window || !window.AudioContext && !window.webkitAudioContext) {
        console.warn("This browser does not support Connection.volume");
    } else if (typeof handler === "function") {
        this.on("volume", handler);
    }
};

Connection.prototype.getLocalStream = function getLocalStream() {
    return this.mediaStream && this.mediaStream.stream;
};

Connection.prototype.getRemoteStream = function getRemoteStream() {
    return this.mediaStream && this.mediaStream._remoteStream;
};

Connection.prototype.postFeedback = function(score, issue) {
    if (typeof score === "undefined" || score === null) {
        return this._postFeedbackDeclined();
    }
    if (FEEDBACK_SCORES.indexOf(score) === -1) {
        throw new Error("Feedback score must be one of: " + FEEDBACK_SCORES);
    }
    if (typeof issue !== "undefined" && issue !== null && FEEDBACK_ISSUES.indexOf(issue) === -1) {
        throw new Error("Feedback issue must be one of: " + FEEDBACK_ISSUES);
    }
    return this._publisher.post("info", "feedback", "received", {
        quality_score: score,
        issue_name: issue
    }, this, true);
};

Connection.prototype._postFeedbackDeclined = function() {
    return this._publisher.post("info", "feedback", "received-none", null, this, true);
};

Connection.prototype._getTempCallSid = function() {
    return this.outboundConnectionId;
};

Connection.prototype._getRealCallSid = function() {
    if (/^TJ/.test(this.parameters.CallSid)) {
        return null;
    } else {
        return this.parameters.CallSid;
    }
};

function cleanupEventListeners(connection) {
    function cleanup() {
        connection.pstream.removeListener("answer", connection._onAnswer);
        connection.pstream.removeListener("cancel", connection._onCancel);
        connection.pstream.removeListener("hangup", connection._onHangup);
    }
    cleanup();
    setTimeout(cleanup, 0);
}

exports.Connection = Connection;