"use strict";

var Log = require("../log");

var StateMachine = require("../statemachine");

var util = require("../util");

var RTCPC = require("./rtcpc");

var ICE_CONNECTION_STATES = {
        new: [ "checking", "closed" ],
        checking: [ "new", "connected", "failed", "closed", "completed" ],
        connected: [ "new", "disconnected", "completed", "closed" ],
        completed: [ "new", "disconnected", "closed", "completed" ],
        failed: [ "new", "disconnected", "closed" ],
        disconnected: [ "connected", "completed", "failed", "closed" ],
        closed: []
    };

var INITIAL_ICE_CONNECTION_STATE = "new";

var SIGNALING_STATES = {
        stable: [ "have-local-offer", "have-remote-offer", "closed" ],
        "have-local-offer": [ "stable", "closed" ],
        "have-remote-offer": [ "stable", "closed" ],
        closed: []
    };

var INITIAL_SIGNALING_STATE = "stable";

function PeerConnection(device, getUserMedia, options) {
    if (!device || !getUserMedia) {
        throw new Error("Device and getUserMedia are required arguments");
    }
    if (!(this instanceof PeerConnection)) {
        return new PeerConnection(device, getUserMedia, options);
    }
    function noop() {}
    this.onopen = noop;
    this.onerror = noop;
    this.onclose = noop;
    this.ondisconnect = noop;
    this.onreconnect = noop;
    this.onsignalingstatechange = noop;
    this.oniceconnectionstatechange = noop;
    this.onicecandidate = noop;
    this.onvolume = noop;
    this.version = null;
    this.pstream = device.stream;
    this.stream = null;
    this.sinkIds = new Set([ "default" ]);
    this.outputs = new Map();
    this.status = "connecting";
    this.callSid = null;
    this.isMuted = false;
    this.getUserMedia = getUserMedia;
    var AudioContext = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    this._isSinkSupported = !!AudioContext && typeof HTMLAudioElement !== "undefined" && HTMLAudioElement.prototype.setSinkId;
    this._audioContext = AudioContext && device.audio._audioContext;
    this._masterAudio = null;
    this._masterAudioDeviceId = null;
    this._mediaStreamSource = null;
    this._dtmfSender = null;
    this._dtmfSenderUnsupported = false;
    this._callEvents = [];
    this._nextTimeToPublish = Date.now();
    this._onAnswerOrRinging = noop;
    this._remoteStream = null;
    this._shouldStopTracks = true;
    this._shouldManageStream = true;
    Log.mixinLog(this, "[Twilio.PeerConnection]");
    this.log.enabled = device.options.debug;
    this.log.warnings = device.options.warnings;
    this._iceConnectionStateMachine = new StateMachine(ICE_CONNECTION_STATES, INITIAL_ICE_CONNECTION_STATE);
    this._signalingStateMachine = new StateMachine(SIGNALING_STATES, INITIAL_SIGNALING_STATE);
    this.options = options = options || {};
    this.navigator = options.navigator || (typeof navigator !== "undefined" ? navigator : null);
    this.util = options.util || util;
    return this;
}

PeerConnection.prototype.uri = function() {
    return this._uri;
};

PeerConnection.prototype.openWithConstraints = function(constraints) {
    return this.getUserMedia({
        audio: constraints
    }).then(this._setInputTracksFromStream.bind(this, false));
};

PeerConnection.prototype.openWithStream = function(stream) {
    var self = this;
    return this._setInputTracksFromStream(true, stream).then(function() {
        self._shouldManageStream = false;
    });
};

PeerConnection.prototype.setInputTracksFromStream = function(stream) {
    var self = this;
    return this._setInputTracksFromStream(true, stream).then(function() {
        self._shouldStopTracks = false;
        self._shouldManageStream = false;
    });
};

PeerConnection.prototype._createAnalyser = function(stream, audioContext) {
    var analyser = audioContext.createAnalyser();
    analyser.fftSize = 32;
    analyser.smoothingTimeConstant = .3;
    var streamSource = audioContext.createMediaStreamSource(stream);
    streamSource.connect(analyser);
    return analyser;
};

PeerConnection.prototype._setVolumeHandler = function(handler) {
    this.onvolume = handler;
};

PeerConnection.prototype._startPollingVolume = function() {
    if (!this._audioContext || !this.stream || !this._remoteStream) {
        return;
    }
    var audioContext = this._audioContext;
    var inputAnalyser = this._inputAnalyser = this._createAnalyser(this.stream, audioContext);
    var inputBufferLength = inputAnalyser.frequencyBinCount;
    var inputDataArray = new Uint8Array(inputBufferLength);
    var outputAnalyser = this._outputAnalyser = this._createAnalyser(this._remoteStream, audioContext);
    var outputBufferLength = outputAnalyser.frequencyBinCount;
    var outputDataArray = new Uint8Array(outputBufferLength);
    var self = this;
    requestAnimationFrame(function emitVolume() {
        if (!self._audioContext) {
            return;
        } else if (self.status === "closed") {
            self._inputAnalyser.disconnect();
            self._outputAnalyser.disconnect();
            return;
        }
        self._inputAnalyser.getByteFrequencyData(inputDataArray);
        var inputVolume = self.util.average(inputDataArray);
        self._outputAnalyser.getByteFrequencyData(outputDataArray);
        var outputVolume = self.util.average(outputDataArray);
        self.onvolume(inputVolume / 255, outputVolume / 255);
        requestAnimationFrame(emitVolume);
    });
};

PeerConnection.prototype._stopStream = function _stopStream(stream) {
    if (!this._shouldStopTracks) {
        return;
    }
    if (typeof MediaStreamTrack.prototype.stop === "function") {
        var audioTracks = typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : stream.audioTracks;
        audioTracks.forEach(function(track) {
            track.stop();
        });
    } else {
        stream.stop();
    }
};

PeerConnection.prototype._setInputTracksFromStream = function(shouldClone, newStream) {
    var self = this;
    if (!newStream) {
        return Promise.reject(new Error("Can not set input stream to null while in a call"));
    }
    if (!newStream.getAudioTracks().length) {
        return Promise.reject(new Error("Supplied input stream has no audio tracks"));
    }
    var localStream = this.stream;
    if (!localStream) {
        this.stream = shouldClone ? newStream.clone() : newStream;
    } else {
        this._stopStream(localStream);
        removeStream(this.version.pc, localStream);
        localStream.getAudioTracks().forEach(localStream.removeTrack, localStream);
        newStream.getAudioTracks().forEach(localStream.addTrack, localStream);
        addStream(this.version.pc, newStream);
    }
    this.mute(this.isMuted);
    if (!this.version) {
        return Promise.resolve(this.stream);
    }
    return new Promise(function(resolve, reject) {
        self.version.createOffer({
            audio: true
        }, function onOfferSuccess() {
            self.version.processAnswer(self._answerSdp, function() {
                if (self._audioContext) {
                    self._inputAnalyser = self._createAnalyser(self.stream, self._audioContext);
                }
                resolve(self.stream);
            }, reject);
        }, reject);
    });
};

PeerConnection.prototype._onInputDevicesChanged = function() {
    if (!this.stream) {
        return;
    }
    var activeInputWasLost = this.stream.getAudioTracks().every(function(track) {
            return track.readyState === "ended";
        });
    if (activeInputWasLost && this._shouldManageStream) {
        this.openWithConstraints(true);
    }
};

PeerConnection.prototype._setSinkIds = function(sinkIds) {
    if (!this._isSinkSupported) {
        return Promise.reject(new Error("Audio output selection is not supported by this browser"));
    }
    this.sinkIds = new Set(sinkIds.forEach ? sinkIds : [ sinkIds ]);
    if (this.version) {
        return this._updateAudioOutputs();
    } else {
        return Promise.resolve();
    }
};

PeerConnection.prototype._updateAudioOutputs = function updateAudioOutputs() {
    var addedOutputIds = Array.from(this.sinkIds).filter(function(id) {
            return !this.outputs.has(id);
        }, this);
    var removedOutputIds = Array.from(this.outputs.keys()).filter(function(id) {
            return !this.sinkIds.has(id);
        }, this);
    var self = this;
    var createOutputPromises = addedOutputIds.map(this._createAudioOutput, this);
    return Promise.all(createOutputPromises).then(function() {
        return Promise.all(removedOutputIds.map(self._removeAudioOutput, self));
    });
};

PeerConnection.prototype._createAudio = function createAudio(arr) {
    return new Audio(arr);
};

PeerConnection.prototype._createAudioOutput = function createAudioOutput(id) {
    var dest = this._audioContext.createMediaStreamDestination();
    this._mediaStreamSource.connect(dest);
    var audio = this._createAudio();
    setAudioSource(audio, dest.stream);
    var self = this;
    return audio.setSinkId(id).then(function() {
        return audio.play();
    }).then(function() {
        self.outputs.set(id, {
            audio: audio,
            dest: dest
        });
    });
};

PeerConnection.prototype._removeAudioOutputs = function removeAudioOutputs() {
    return Array.from(this.outputs.keys()).map(this._removeAudioOutput, this);
};

PeerConnection.prototype._disableOutput = function disableOutput(pc, id) {
    var output = pc.outputs.get(id);
    if (!output) {
        return;
    }
    if (output.audio) {
        output.audio.pause();
        output.audio.src = "";
    }
    if (output.dest) {
        output.dest.disconnect();
    }
};

PeerConnection.prototype._reassignMasterOutput = function reassignMasterOutput(pc, masterId) {
    var masterOutput = pc.outputs.get(masterId);
    pc.outputs.delete(masterId);
    var self = this;
    var idToReplace = Array.from(pc.outputs.keys())[0] || "default";
    return masterOutput.audio.setSinkId(idToReplace).then(function() {
        self._disableOutput(pc, idToReplace);
        pc.outputs.set(idToReplace, masterOutput);
        pc._masterAudioDeviceId = idToReplace;
    }).catch(function rollback(reason) {
        pc.outputs.set(masterId, masterOutput);
        throw reason;
    });
};

PeerConnection.prototype._removeAudioOutput = function removeAudioOutput(id) {
    if (this._masterAudioDeviceId === id) {
        return this._reassignMasterOutput(this, id);
    }
    this._disableOutput(this, id);
    this.outputs.delete(id);
    return Promise.resolve();
};

PeerConnection.prototype._onAddTrack = function onAddTrack(pc, stream) {
    var audio = pc._masterAudio = this._createAudio();
    setAudioSource(audio, stream);
    audio.play();
    var deviceId = Array.from(pc.outputs.keys())[0] || "default";
    pc._masterAudioDeviceId = deviceId;
    pc.outputs.set(deviceId, {
        audio: audio
    });
    pc._mediaStreamSource = pc._audioContext.createMediaStreamSource(stream);
    pc.pcStream = stream;
    pc._updateAudioOutputs();
};

PeerConnection.prototype._fallbackOnAddTrack = function fallbackOnAddTrack(pc, stream) {
    var audio = document && document.createElement("audio");
    audio.autoplay = true;
    if (!setAudioSource(audio, stream)) {
        pc.log("Error attaching stream to element.");
    }
    pc.outputs.set("default", {
        audio: audio
    });
};

PeerConnection.prototype._setupPeerConnection = function(rtcConstraints, iceServers) {
    var self = this;
    var version = this._getProtocol();
    version.create(this.log, rtcConstraints, iceServers);
    addStream(version.pc, this.stream);
    var eventName = "ontrack" in version.pc ? "ontrack" : "onaddstream";
    version.pc[eventName] = function(event) {
        var stream = self._remoteStream = event.stream || event.streams[0];
        if (self._isSinkSupported) {
            self._onAddTrack(self, stream);
        } else {
            self._fallbackOnAddTrack(self, stream);
        }
        self._startPollingVolume();
    };
    return version;
};

PeerConnection.prototype._setupChannel = function() {
    var self = this;
    var pc = this.version.pc;
    self.version.pc.onopen = function() {
        self.status = "open";
        self.onopen();
    };
    self.version.pc.onstatechange = function() {
        if (self.version.pc && self.version.pc.readyState === "stable") {
            self.status = "open";
            self.onopen();
        }
    };
    self.version.pc.onsignalingstatechange = function() {
        var state = pc.signalingState;
        self.log('signalingState is "' + state + '"');
        try {
            self._signalingStateMachine.transition(state);
        } catch (error) {
            self.log("Failed to transition to signaling state " + state + ": " + error);
        }
        if (self.version.pc && self.version.pc.signalingState === "stable") {
            self.status = "open";
            self.onopen();
        }
        self.onsignalingstatechange(pc.signalingState);
    };
    pc.onicecandidate = function onicecandidate(event) {
        self.onicecandidate(event.candidate);
    };
    pc.oniceconnectionstatechange = function() {
        var state = pc.iceConnectionState;
        var previousState = self._iceConnectionStateMachine.currentState;
        try {
            self._iceConnectionStateMachine.transition(state);
        } catch (error) {
            self.log("Failed to transition to ice connection state " + state + ": " + error);
        }
        var message;
        switch (state) {
          case "connected":
            if (previousState === "disconnected") {
                message = "ICE liveliness check succeeded. Connection with Twilio restored";
                self.log(message);
                self.onreconnect(message);
            }
            break;

          case "disconnected":
            message = "ICE liveliness check failed. May be having trouble connecting to Twilio";
            self.log(message);
            self.ondisconnect(message);
            break;

          case "failed":
            message = (previousState === "checking" ? "ICE negotiation with Twilio failed." : "Connection with Twilio was interrupted.") + " Call will terminate.";
            self.log(message);
            self.onerror({
                info: {
                    code: 31003,
                    message: message
                },
                disconnect: true
            });
            break;

          default:
            self.log('iceConnectionState is "' + state + '"');
        }
        self.oniceconnectionstatechange(state);
    };
};

PeerConnection.prototype._initializeMediaStream = function(rtcConstraints, iceServers) {
    if (this.status === "open") {
        return false;
    }
    if (this.pstream.status === "disconnected") {
        this.onerror({
            info: {
                code: 31e3,
                message: "Cannot establish connection. Client is disconnected"
            }
        });
        this.close();
        return false;
    }
    this.version = this._setupPeerConnection(rtcConstraints, iceServers);
    this._setupChannel();
    return true;
};

PeerConnection.prototype.makeOutgoingCall = function(token, params, callsid, rtcConstraints, iceServers, onMediaStarted) {
    if (!this._initializeMediaStream(rtcConstraints, iceServers)) {
        return;
    }
    var self = this;
    this.callSid = callsid;
    function onAnswerSuccess() {
        onMediaStarted(self.version.pc);
    }
    function onAnswerError(err) {
        var errMsg = err.message || err;
        self.onerror({
            info: {
                code: 31e3,
                message: "Error processing answer: " + errMsg
            }
        });
    }
    this._onAnswerOrRinging = function(payload) {
        if (!payload.sdp) {
            return;
        }
        self._answerSdp = payload.sdp;
        if (self.status !== "closed") {
            self.version.processAnswer(payload.sdp, onAnswerSuccess, onAnswerError);
        }
        self.pstream.removeListener("answer", self._onAnswerOrRinging);
        self.pstream.removeListener("ringing", self._onAnswerOrRinging);
    };
    this.pstream.on("answer", this._onAnswerOrRinging);
    this.pstream.on("ringing", this._onAnswerOrRinging);
    function onOfferSuccess() {
        if (self.status !== "closed") {
            self.pstream.publish("invite", {
                sdp: self.version.getSDP(),
                callsid: self.callSid,
                twilio: {
                    accountsid: token ? self.util.objectize(token).iss : null,
                    params: params
                }
            });
        }
    }
    function onOfferError(err) {
        var errMsg = err.message || err;
        self.onerror({
            info: {
                code: 31e3,
                message: "Error creating the offer: " + errMsg
            }
        });
    }
    this.version.createOffer({
        audio: true
    }, onOfferSuccess, onOfferError);
};

PeerConnection.prototype.answerIncomingCall = function(callSid, sdp, rtcConstraints, iceServers, onMediaStarted) {
    if (!this._initializeMediaStream(rtcConstraints, iceServers)) {
        return;
    }
    this._answerSdp = sdp.replace(/^a=setup:actpass$/gm, "a=setup:passive");
    this.callSid = callSid;
    var self = this;
    function onAnswerSuccess() {
        if (self.status !== "closed") {
            self.pstream.publish("answer", {
                callsid: callSid,
                sdp: self.version.getSDP()
            });
            onMediaStarted(self.version.pc);
        }
    }
    function onAnswerError(err) {
        var errMsg = err.message || err;
        self.onerror({
            info: {
                code: 31e3,
                message: "Error creating the answer: " + errMsg
            }
        });
    }
    this.version.processSDP(sdp, {
        audio: true
    }, onAnswerSuccess, onAnswerError);
};

PeerConnection.prototype.close = function() {
    if (this.version && this.version.pc) {
        if (this.version.pc.signalingState !== "closed") {
            this.version.pc.close();
        }
        this.version.pc = null;
    }
    if (this.stream) {
        this.mute(false);
        this._stopStream(this.stream);
    }
    this.stream = null;
    if (this.pstream) {
        this.pstream.removeListener("answer", this._onAnswerOrRinging);
    }
    this._removeAudioOutputs();
    if (this._mediaStreamSource) {
        this._mediaStreamSource.disconnect();
    }
    if (this._inputAnalyser) {
        this._inputAnalyser.disconnect();
    }
    if (this._outputAnalyser) {
        this._outputAnalyser.disconnect();
    }
    this.status = "closed";
    this.onclose();
};

PeerConnection.prototype.reject = function(callSid) {
    this.callSid = callSid;
};

PeerConnection.prototype.ignore = function(callSid) {
    this.callSid = callSid;
};

PeerConnection.prototype.mute = function(shouldMute) {
    this.isMuted = shouldMute;
    if (!this.stream) {
        return;
    }
    var audioTracks = typeof this.stream.getAudioTracks === "function" ? this.stream.getAudioTracks() : this.stream.audioTracks;
    audioTracks[0].enabled = !shouldMute;
};

PeerConnection.prototype.getOrCreateDTMFSender = function getOrCreateDTMFSender() {
    if (this._dtmfSender || this._dtmfSenderUnsupported) {
        return this._dtmfSender || null;
    }
    var self = this;
    var pc = this.version.pc;
    if (!pc) {
        this.log("No RTCPeerConnection available to call createDTMFSender on");
        return null;
    }
    if (typeof pc.getSenders === "function" && (typeof RTCDTMFSender === "function" || typeof RTCDtmfSender === "function")) {
        var sender = pc.getSenders().find(function(sender) {
                return sender.dtmf;
            });
        if (sender && sender.dtmf) {
            this.log("Using RTCRtpSender#dtmf");
            this._dtmfSender = sender.dtmf;
            return this._dtmfSender;
        }
    }
    if (typeof pc.createDTMFSender === "function" && typeof pc.getLocalStreams === "function") {
        var track = pc.getLocalStreams().map(function(stream) {
                var tracks = self._getAudioTracks(stream);
                return tracks && tracks[0];
            })[0];
        if (!track) {
            this.log("No local audio MediaStreamTrack available on the RTCPeerConnection to pass to createDTMFSender");
            return null;
        }
        this.log("Creating RTCDTMFSender");
        this._dtmfSender = pc.createDTMFSender(track);
        return this._dtmfSender;
    }
    this.log("RTCPeerConnection does not support RTCDTMFSender");
    this._dtmfSenderUnsupported = true;
    return null;
};

PeerConnection.prototype._canStopMediaStreamTrack = function() {
    return typeof MediaStreamTrack.prototype.stop === "function";
};

PeerConnection.prototype._getAudioTracks = function(stream) {
    if (typeof stream.getAudioTracks === "function") {
        return stream.getAudioTracks();
    } else {
        return stream.audioTracks;
    }
};

PeerConnection.prototype._getProtocol = function() {
    return PeerConnection.protocol;
};

PeerConnection.protocol = function() {
    if (RTCPC.test()) {
        return new RTCPC();
    } else {
        return null;
    }
}();

function addStream(pc, stream) {
    if (typeof pc.addTrack === "function") {
        stream.getAudioTracks().forEach(function(track) {
            pc.addTrack(track, stream);
        });
    } else {
        pc.addStream(stream);
    }
}

function removeStream(pc, stream) {
    if (typeof pc.removeTrack === "function") {
        pc.getSenders().forEach(function(sender) {
            pc.removeTrack(sender);
        });
    } else {
        pc.removeStream(stream);
    }
}

function setAudioSource(audio, stream) {
    if (typeof audio.srcObject !== "undefined") {
        audio.srcObject = stream;
    } else if (typeof audio.mozSrcObject !== "undefined") {
        audio.mozSrcObject = stream;
    } else if (typeof audio.src !== "undefined") {
        var _window = audio.options.window || window;
        audio.src = (_window.URL || _window.webkitURL).createObjectURL(stream);
    } else {
        return false;
    }
    return true;
}

PeerConnection.enabled = !!PeerConnection.protocol;

module.exports = PeerConnection;