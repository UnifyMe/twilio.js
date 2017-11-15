"use strict";

var AudioHelper = require("./audiohelper");

var EventEmitter = require("events").EventEmitter;

var util = require("util");

var log = require("./log");

var twutil = require("./util");

var rtc = require("./rtc");

var Publisher = require("./eventpublisher");

var Options = require("./options").Options;

var Sound = require("./sound");

var Connection = require("./connection").Connection;

var getUserMedia = require("./rtc/getusermedia");

var PStream = require("./pstream").PStream;

var REG_INTERVAL = 3e4;

var RINGTONE_PLAY_TIMEOUT = 2e3;

function Device(token, options) {
    if (!rtc.enabled()) {
        throw new twutil.Exception("twilio.js 1.3 requires WebRTC/ORTC browser support. " + "For more information, see <https://www.twilio.com/docs/api/client/twilio-js>. " + "If you have any questions about this announcement, please contact " + "Twilio Support at <help@twilio.com>.");
    }
    if (!(this instanceof Device)) {
        return new Device(token, options);
    }
    twutil.monitorEventEmitter("Twilio.Device", this);
    if (!token) {
        throw new twutil.Exception("Capability token is not valid or missing.");
    }
    options = options || {};
    var origOptions = {};
    for (var i in options) {
        origOptions[i] = options[i];
    }
    var DefaultSound = options.soundFactory || Sound;
    var defaults = {
            logPrefix: "[Device]",
            chunderw: "chunderw-vpc-gll.twilio.com",
            eventgw: "eventgw.twilio.com",
            Sound: DefaultSound,
            connectionFactory: Connection,
            pStreamFactory: PStream,
            noRegister: false,
            encrypt: false,
            closeProtection: false,
            secureSignaling: true,
            warnings: true,
            audioConstraints: true,
            iceServers: [],
            region: "gll",
            dscp: true,
            sounds: {}
        };
    options = options || {};
    var chunderw = options.chunderw;
    for (var prop in defaults) {
        if (prop in options) {
            continue;
        }
        options[prop] = defaults[prop];
    }
    if (options.dscp) {
        options.rtcConstraints = {
            optional: [ {
                googDscp: true
            } ]
        };
    } else {
        options.rtcConstraints = {};
    }
    this.options = options;
    this.token = token;
    this._status = "offline";
    this._region = "offline";
    this._connectionSinkIds = [ "default" ];
    this._connectionInputStream = null;
    this.connections = [];
    this._activeConnection = null;
    this.sounds = new Options({
        incoming: true,
        outgoing: true,
        disconnect: true
    });
    log.mixinLog(this, this.options.logPrefix);
    this.log.enabled = this.options.debug;
    var regions = {
            gll: "chunderw-vpc-gll.twilio.com",
            au1: "chunderw-vpc-gll-au1.twilio.com",
            br1: "chunderw-vpc-gll-br1.twilio.com",
            de1: "chunderw-vpc-gll-de1.twilio.com",
            ie1: "chunderw-vpc-gll-ie1.twilio.com",
            jp1: "chunderw-vpc-gll-jp1.twilio.com",
            sg1: "chunderw-vpc-gll-sg1.twilio.com",
            us1: "chunderw-vpc-gll-us1.twilio.com",
            "us1-tnx": "chunderw-vpc-gll-us1-tnx.twilio.com",
            "us2-tnx": "chunderw-vpc-gll-us2-tnx.twilio.com",
            "ie1-tnx": "chunderw-vpc-gll-ie1-tnx.twilio.com",
            "us1-ix": "chunderw-vpc-gll-us1-ix.twilio.com",
            "us2-ix": "chunderw-vpc-gll-us2-ix.twilio.com",
            "ie1-ix": "chunderw-vpc-gll-ie1-ix.twilio.com"
        };
    var deprecatedRegions = {
            au: "au1",
            br: "br1",
            ie: "ie1",
            jp: "jp1",
            sg: "sg1",
            "us-va": "us1",
            "us-or": "us1"
        };
    var region = options.region.toLowerCase();
    if (region in deprecatedRegions) {
        this.log.deprecated("Region " + region + " is deprecated, please use " + deprecatedRegions[region] + ".");
        region = deprecatedRegions[region];
    }
    if (!(region in regions)) {
        throw new twutil.Exception("Region " + options.region + " is invalid. " + "Valid values are: " + Object.keys(regions).join(", "));
    }
    options.chunderw = chunderw || regions[region];
    this.soundcache = new Map();
    var a = typeof document !== "undefined" ? document.createElement("audio") : {};
    var canPlayMp3;
    try {
        canPlayMp3 = a.canPlayType && !!a.canPlayType("audio/mpeg").replace(/no/, "");
    } catch (e) {
        canPlayMp3 = false;
    }
    var canPlayVorbis;
    try {
        canPlayVorbis = a.canPlayType && !!a.canPlayType("audio/ogg;codecs='vorbis'").replace(/no/, "");
    } catch (e) {
        canPlayVorbis = false;
    }
    var ext = "mp3";
    if (canPlayVorbis && !canPlayMp3) {
        ext = "ogg";
    }
    var defaultSounds = {
            incoming: {
                filename: "incoming",
                shouldLoop: true
            },
            outgoing: {
                filename: "outgoing",
                maxDuration: 3e3
            },
            disconnect: {
                filename: "disconnect",
                maxDuration: 3e3
            },
            dtmf1: {
                filename: "dtmf-1",
                maxDuration: 1e3
            },
            dtmf2: {
                filename: "dtmf-2",
                maxDuration: 1e3
            },
            dtmf3: {
                filename: "dtmf-3",
                maxDuration: 1e3
            },
            dtmf4: {
                filename: "dtmf-4",
                maxDuration: 1e3
            },
            dtmf5: {
                filename: "dtmf-5",
                maxDuration: 1e3
            },
            dtmf6: {
                filename: "dtmf-6",
                maxDuration: 1e3
            },
            dtmf7: {
                filename: "dtmf-7",
                maxDuration: 1e3
            },
            dtmf8: {
                filename: "dtmf-8",
                maxDuration: 1e3
            },
            dtmf9: {
                filename: "dtmf-9",
                maxDuration: 1e3
            },
            dtmf0: {
                filename: "dtmf-0",
                maxDuration: 1e3
            },
            dtmfs: {
                filename: "dtmf-star",
                maxDuration: 1e3
            },
            dtmfh: {
                filename: "dtmf-hash",
                maxDuration: 1e3
            }
        };
    var base = twutil.getTwilioRoot() + "sounds/releases/" + twutil.getSoundVersion() + "/";
    for (var name in defaultSounds) {
        var soundDef = defaultSounds[name];
        var defaultUrl = base + soundDef.filename + "." + ext + "?cache=1_4_23";
        var soundUrl = options.sounds[name] || defaultUrl;
        var sound = new this.options.Sound(name, soundUrl, {
                maxDuration: soundDef.maxDuration,
                minDuration: soundDef.minDuration,
                shouldLoop: soundDef.shouldLoop,
                audioContext: Device.audioContext
            });
        this.soundcache.set(name, sound);
    }
    var self = this;
    function createDefaultPayload(connection) {
        var payload = {
                client_name: self._clientName,
                platform: rtc.getMediaEngine(),
                sdk_version: twutil.getReleaseVersion(),
                selected_region: self.options.region
            };
        function setIfDefined(propertyName, value) {
            if (value) {
                payload[propertyName] = value;
            }
        }
        if (connection) {
            setIfDefined("call_sid", connection._getRealCallSid());
            setIfDefined("temp_call_sid", connection._getTempCallSid());
            payload.direction = connection._direction;
        }
        var stream = self.stream;
        if (stream) {
            setIfDefined("gateway", stream.gateway);
            setIfDefined("region", stream.region);
        }
        return payload;
    }
    var publisher = this._publisher = new Publisher("twilio-js-sdk", this.token, {
            host: this.options.eventgw,
            defaultPayload: createDefaultPayload
        });
    if (options.publishEvents === false) {
        publisher.disable();
    }
    function updateSinkIds(type, sinkIds) {
        var promise = type === "ringtone" ? updateRingtoneSinkIds(sinkIds) : updateSpeakerSinkIds(sinkIds);
        return promise.then(function() {
            publisher.info("audio", type + "-devices-set", {
                audio_device_ids: sinkIds
            }, self._activeConnection);
        }, function(error) {
            publisher.error("audio", type + "-devices-set-failed", {
                audio_device_ids: sinkIds,
                message: error.message
            }, self._activeConnection);
            throw error;
        });
    }
    function updateSpeakerSinkIds(sinkIds) {
        sinkIds = sinkIds.forEach ? sinkIds : [ sinkIds ];
        Array.from(self.soundcache.entries()).forEach(function(entry) {
            if (entry[0] !== "incoming") {
                entry[1].setSinkIds(sinkIds);
            }
        });
        self._connectionSinkIds = sinkIds;
        var connection = self._activeConnection;
        if (connection) {
            return connection._setSinkIds(sinkIds);
        } else {
            return Promise.resolve();
        }
    }
    function updateRingtoneSinkIds(sinkIds) {
        return Promise.resolve(self.soundcache.get("incoming").setSinkIds(sinkIds));
    }
    function updateInputStream(inputStream) {
        var connection = self._activeConnection;
        if (connection && !inputStream) {
            return Promise.reject(new Error("Cannot unset input device while a call is in progress."));
        }
        self._connectionInputStream = inputStream;
        if (connection) {
            return connection._setInputTracksFromStream(inputStream);
        } else {
            return Promise.resolve();
        }
    }
    var audio = this.audio = new AudioHelper(updateSinkIds, updateInputStream, getUserMedia, {
            soundOptions: this.sounds,
            audioContext: Device.audioContext
        });
    audio.on("deviceChange", function(lostActiveDevices) {
        var activeConnection = self._activeConnection;
        var deviceIds = lostActiveDevices.map(function(device) {
                return device.deviceId;
            });
        publisher.info("audio", "device-change", {
            lost_active_device_ids: deviceIds
        }, activeConnection);
        if (activeConnection) {
            activeConnection.mediaStream._onInputDevicesChanged();
        }
    });
    this.mediaPresence = {
        audio: !this.options.noRegister
    };
    this.register(this.token);
    var closeProtection = this.options.closeProtection;
    function confirmClose(event) {
        if (self._activeConnection) {
            var defaultMsg = "A call is currently in-progress. " + "Leaving or reloading this page will end the call.";
            var confirmationMsg = closeProtection === true ? defaultMsg : closeProtection;
            (event || window.event).returnValue = confirmationMsg;
            return confirmationMsg;
        }
    }
    if (closeProtection) {
        if (typeof window !== "undefined") {
            if (window.addEventListener) {
                window.addEventListener("beforeunload", confirmClose);
            } else if (window.attachEvent) {
                window.attachEvent("onbeforeunload", confirmClose);
            }
        }
    }
    function onClose() {
        self.disconnectAll();
    }
    if (typeof window !== "undefined") {
        if (window.addEventListener) {
            window.addEventListener("unload", onClose);
        } else if (window.attachEvent) {
            window.attachEvent("onunload", onClose);
        }
    }
    this.on("error", function() {});
    return this;
}

util.inherits(Device, EventEmitter);

function makeConnection(device, params, options) {
    var defaults = {
            getSinkIds: function() {
                return device._connectionSinkIds;
            },
            getInputStream: function() {
                return device._connectionInputStream;
            },
            debug: device.options.debug,
            encrypt: device.options.encrypt,
            warnings: device.options.warnings,
            publisher: device._publisher
        };
    options = options || {};
    for (var prop in defaults) {
        if (prop in options) {
            continue;
        }
        options[prop] = defaults[prop];
    }
    var connection = device.options.connectionFactory(device, params, getUserMedia, options);
    connection.once("accept", function() {
        device._activeConnection = connection;
        device._removeConnection(connection);
        device.audio._maybeStartPollingVolume();
        device.emit("connect", connection);
    });
    connection.addListener("error", function(error) {
        if (connection.status() === "closed") {
            device._removeConnection(connection);
        }
        device.audio._maybeStopPollingVolume();
        device.emit("error", error);
    });
    connection.once("cancel", function() {
        device.log("Canceled: " + connection.parameters.CallSid);
        device._removeConnection(connection);
        device.audio._maybeStopPollingVolume();
        device.emit("cancel", connection);
    });
    connection.once("disconnect", function() {
        device.audio._maybeStopPollingVolume();
        device._removeConnection(connection);
        if (device._activeConnection === connection) {
            device._activeConnection = null;
        }
        device.emit("disconnect", connection);
    });
    connection.once("reject", function() {
        device.log("Rejected: " + connection.parameters.CallSid);
        device.audio._maybeStopPollingVolume();
        device._removeConnection(connection);
    });
    return connection;
}

Device.toString = function() {
    return "[Twilio.Device class]";
};

Device.prototype.toString = function() {
    return "[Twilio.Device instance]";
};

Device.prototype.register = function(token) {
    var objectized = twutil.objectize(token);
    this._accountSid = objectized.iss;
    this._clientName = objectized.scope["client:incoming"] ? objectized.scope["client:incoming"].params.clientName : null;
    if (this.stream) {
        this.stream.setToken(token);
        this._publisher.setToken(token);
    } else {
        this._setupStream(token);
    }
};

Device.prototype.registerPresence = function() {
    if (!this.token) {
        return;
    }
    var tokenIncomingObject = twutil.objectize(this.token).scope["client:incoming"];
    if (tokenIncomingObject) {
        this.mediaPresence.audio = true;
    }
    this._sendPresence();
};

Device.prototype.unregisterPresence = function() {
    this.mediaPresence.audio = false;
    this._sendPresence();
};

Device.prototype.connect = function(params, audioConstraints) {
    if (typeof params === "function") {
        return this.addListener("connect", params);
    }
    if (this._activeConnection) {
        throw new Error("A Connection is already active");
    }
    params = params || {};
    audioConstraints = audioConstraints || this.options.audioConstraints;
    var connection = this._activeConnection = makeConnection(this, params);
    this.connections.splice(0).forEach(function(conn) {
        conn.ignore();
    });
    this.soundcache.get("incoming").stop();
    if (this.sounds.__dict__.outgoing) {
        var self = this;
        connection.accept(function() {
            self.soundcache.get("outgoing").play();
        });
    }
    connection.accept(audioConstraints);
    return connection;
};

Device.prototype.disconnectAll = function() {
    var connections = [].concat(this.connections);
    for (var i = 0; i < connections.length; i++) {
        connections[i].disconnect();
    }
    if (this._activeConnection) {
        this._activeConnection.disconnect();
    }
    if (this.connections.length > 0) {
        this.log("Connections left pending: " + this.connections.length);
    }
};

Device.prototype.destroy = function() {
    this._stopRegistrationTimer();
    this.audio._unbind();
    if (this.stream) {
        this.stream.destroy();
        this.stream = null;
    }
};

Device.prototype.disconnect = function(handler) {
    this.addListener("disconnect", handler);
};

Device.prototype.incoming = function(handler) {
    this.addListener("incoming", handler);
};

Device.prototype.offline = function(handler) {
    this.addListener("offline", handler);
};

Device.prototype.ready = function(handler) {
    this.addListener("ready", handler);
};

Device.prototype.error = function(handler) {
    this.addListener("error", handler);
};

Device.prototype.status = function() {
    if (this._activeConnection) {
        return "busy";
    } else {
        return this._status;
    }
};

Device.prototype.activeConnection = function() {
    return this._activeConnection || this.connections[0];
};

Device.prototype.region = function() {
    return this._region;
};

Device.prototype._sendPresence = function() {
    this.stream.register(this.mediaPresence);
    if (this.mediaPresence.audio) {
        this._startRegistrationTimer();
    } else {
        this._stopRegistrationTimer();
    }
};

Device.prototype._startRegistrationTimer = function() {
    clearTimeout(this.regTimer);
    var self = this;
    this.regTimer = setTimeout(function() {
        self._sendPresence();
    }, REG_INTERVAL);
};

Device.prototype._stopRegistrationTimer = function() {
    clearTimeout(this.regTimer);
};

Device.prototype._setupStream = function(token) {
    var self = this;
    this.log("Setting up PStream");
    var streamOptions = {
            chunderw: this.options.chunderw,
            debug: this.options.debug,
            secureSignaling: this.options.secureSignaling
        };
    this.stream = this.options.pStreamFactory(token, streamOptions);
    this.stream.addListener("connected", function(payload) {
        var regions = {
                US_EAST_VIRGINIA: "us1",
                US_WEST_OREGON: "us2",
                ASIAPAC_SYDNEY: "au1",
                SOUTH_AMERICA_SAO_PAULO: "br1",
                EU_IRELAND: "ie1",
                ASIAPAC_TOKYO: "jp1",
                ASIAPAC_SINGAPORE: "sg1"
            };
        self._region = regions[payload.region] || payload.region;
        self._sendPresence();
    });
    this.stream.addListener("ready", function() {
        self.log("Stream is ready");
        if (self._status === "offline") {
            self._status = "ready";
        }
        self.emit("ready", self);
    });
    this.stream.addListener("offline", function() {
        self.log("Stream is offline");
        self._status = "offline";
        self._region = "offline";
        self.emit("offline", self);
    });
    this.stream.addListener("error", function(payload) {
        var error = payload.error;
        if (error) {
            if (payload.callsid) {
                error.connection = self._findConnection(payload.callsid);
            }
            if (error.code === 31205) {
                self._stopRegistrationTimer();
            }
            self.log("Received error: ", error);
            self.emit("error", error);
        }
    });
    this.stream.addListener("invite", function(payload) {
        if (self._activeConnection) {
            self.log("Device busy; ignoring incoming invite");
            return;
        }
        if (!payload.callsid || !payload.sdp) {
            self.emit("error", {
                message: "Malformed invite from gateway"
            });
            return;
        }
        var params = payload.parameters || {};
        params.CallSid = params.CallSid || payload.callsid;
        function maybeStopIncomingSound() {
            if (!self.connections.length) {
                self.soundcache.get("incoming").stop();
            }
        }
        var connection = makeConnection(self, {}, {
                offerSdp: payload.sdp,
                callParameters: params
            });
        self.connections.push(connection);
        connection.once("accept", function() {
            self.soundcache.get("incoming").stop();
        });
        [ "cancel", "error", "reject" ].forEach(function(event) {
            connection.once(event, maybeStopIncomingSound);
        });
        var play = self.sounds.__dict__.incoming ? function() {
                return self.soundcache.get("incoming").play();
            } : function() {
                return Promise.resolve();
            };
        self._showIncomingConnection(connection, play);
    });
};

Device.prototype._showIncomingConnection = function(connection, play) {
    var self = this;
    var timeout;
    return Promise.race([ play(), new Promise(function(resolve, reject) {
        timeout = setTimeout(function() {
            reject(new Error("Playing incoming ringtone took too long; it might not play. Continuing execution..."));
        }, RINGTONE_PLAY_TIMEOUT);
    }) ]).catch(function(reason) {
        console.warn(reason.message);
    }).then(function() {
        clearTimeout(timeout);
        self.emit("incoming", connection);
    });
};

Device.prototype._removeConnection = function(connection) {
    for (var i = this.connections.length - 1; i >= 0; i--) {
        if (connection === this.connections[i]) {
            this.connections.splice(i, 1);
        }
    }
};

Device.prototype._findConnection = function(callsid) {
    for (var i = 0; i < this.connections.length; i++) {
        var conn = this.connections[i];
        if (conn.parameters.CallSid === callsid || conn.outboundConnectionId === callsid) {
            return conn;
        }
    }
    return null;
};

function singletonwrapper(cls) {
    var afterSetup = [];
    var tasks = [];
    function enqueue(task) {
        if (cls.instance) {
            task();
        } else {
            tasks.push(task);
        }
    }
    function defaultErrorHandler(error) {
        var errorMessage = (error.code ? error.code + ": " : "") + error.message;
        if (cls.instance) {
            var n = 0;
            var listeners = cls.instance.listeners("error");
            for (var i = 0; i < listeners.length; i++) {
                if (listeners[i] !== defaultErrorHandler) {
                    n++;
                }
            }
            if (n > 1) {
                return;
            }
            cls.instance.log(errorMessage);
        }
        throw new twutil.Exception(errorMessage);
    }
    var members = {
            instance: null,
            setup: function(token, options) {
                if (!cls.audioContext) {
                    if (typeof AudioContext !== "undefined") {
                        cls.audioContext = new AudioContext();
                    } else if (typeof webkitAudioContext !== "undefined") {
                        cls.audioContext = new webkitAudioContext();
                    }
                }
                var i;
                if (cls.instance) {
                    cls.instance.log("Found existing Device; using new token but ignoring options");
                    cls.instance.token = token;
                    cls.instance.register(token);
                } else {
                    cls.instance = new Device(token, options);
                    cls.error(defaultErrorHandler);
                    cls.sounds = cls.instance.sounds;
                    for (i = 0; i < tasks.length; i++) {
                        tasks[i]();
                    }
                    tasks = [];
                }
                for (i = 0; i < afterSetup.length; i++) {
                    afterSetup[i](token, options);
                }
                afterSetup = [];
                return cls;
            },
            connect: function(parameters, audioConstraints) {
                if (typeof parameters === "function") {
                    enqueue(function() {
                        cls.instance.addListener("connect", parameters);
                    });
                    return null;
                }
                if (!cls.instance) {
                    throw new twutil.Exception("Run Twilio.Device.setup()");
                }
                if (cls.instance.connections.length > 0) {
                    cls.instance.emit("error", {
                        message: "A connection is currently active"
                    });
                    return null;
                }
                return cls.instance.connect(parameters, audioConstraints);
            },
            disconnectAll: function() {
                enqueue(function() {
                    cls.instance.disconnectAll();
                });
                return cls;
            },
            disconnect: function(handler) {
                enqueue(function() {
                    cls.instance.addListener("disconnect", handler);
                });
                return cls;
            },
            status: function() {
                if (!cls.instance) {
                    throw new twutil.Exception("Run Twilio.Device.setup()");
                }
                return cls.instance.status();
            },
            region: function() {
                if (!cls.instance) {
                    throw new twutil.Exception("Run Twilio.Device.setup()");
                }
                return cls.instance.region();
            },
            ready: function(handler) {
                enqueue(function() {
                    cls.instance.addListener("ready", handler);
                });
                return cls;
            },
            error: function(handler) {
                enqueue(function() {
                    if (handler !== defaultErrorHandler) {
                        cls.instance.removeListener("error", defaultErrorHandler);
                    }
                    cls.instance.addListener("error", handler);
                });
                return cls;
            },
            offline: function(handler) {
                enqueue(function() {
                    cls.instance.addListener("offline", handler);
                });
                return cls;
            },
            incoming: function(handler) {
                enqueue(function() {
                    cls.instance.addListener("incoming", handler);
                });
                return cls;
            },
            destroy: function() {
                if (cls.instance) {
                    cls.instance.destroy();
                }
                return cls;
            },
            cancel: function(handler) {
                enqueue(function() {
                    cls.instance.addListener("cancel", handler);
                });
                return cls;
            },
            activeConnection: function() {
                if (!cls.instance) {
                    return null;
                }
                return cls.instance.activeConnection();
            }
        };
    for (var method in members) {
        cls[method] = members[method];
    }
    Object.defineProperties(cls, {
        audio: {
            get: function() {
                return cls.instance.audio;
            }
        }
    });
    return cls;
}

exports.Device = singletonwrapper(Device);