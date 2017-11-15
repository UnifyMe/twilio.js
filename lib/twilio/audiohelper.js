"use strict";

var EventEmitter = require("events").EventEmitter;

var inherits = require("util").inherits;

var MediaDeviceInfoShim = require("./shims/mediadeviceinfo");

var defaultMediaDevices = require("./shims/mediadevices");

var OutputDeviceCollection = require("./outputdevicecollection");

var util = require("./util");

function AudioHelper(onActiveOutputsChanged, onActiveInputChanged, getUserMedia, options) {
    if (!(this instanceof AudioHelper)) {
        return new AudioHelper(onActiveOutputsChanged, onActiveInputChanged, getUserMedia, options);
    }
    EventEmitter.call(this);
    options = Object.assign({
        AudioContext: typeof AudioContext !== "undefined" && AudioContext,
        mediaDevices: defaultMediaDevices,
        setSinkId: typeof HTMLAudioElement !== "undefined" && HTMLAudioElement.prototype.setSinkId
    }, options);
    var availableInputDevices = new Map();
    var availableOutputDevices = new Map();
    var isAudioContextSupported = !!(options.AudioContext || options.audioContext);
    var mediaDevices = options.mediaDevices;
    var isEnumerationSupported = mediaDevices && mediaDevices.enumerateDevices || false;
    var isSetSinkSupported = typeof options.setSinkId === "function";
    var isOutputSelectionSupported = isEnumerationSupported && isSetSinkSupported;
    var isVolumeSupported = isAudioContextSupported;
    if (options.soundOptions) {
        addOptionsToAudioHelper(this, options.soundOptions);
    }
    var audioContext = null;
    var inputVolumeAnalyser = null;
    if (isVolumeSupported) {
        audioContext = options.audioContext || new options.AudioContext();
        inputVolumeAnalyser = audioContext.createAnalyser();
        inputVolumeAnalyser.fftSize = 32;
        inputVolumeAnalyser.smoothingTimeConstant = .3;
    }
    var self = this;
    Object.defineProperties(this, {
        _audioContext: {
            value: audioContext
        },
        _getUserMedia: {
            value: getUserMedia
        },
        _inputDevice: {
            value: null,
            writable: true
        },
        _inputStream: {
            value: null,
            writable: true
        },
        _inputVolumeAnalyser: {
            value: inputVolumeAnalyser
        },
        _isPollingInputVolume: {
            value: false,
            writable: true
        },
        _onActiveInputChanged: {
            value: onActiveInputChanged
        },
        _mediaDevices: {
            value: mediaDevices
        },
        _unknownDeviceIndexes: {
            value: {}
        },
        _updateAvailableDevices: {
            value: updateAvailableDevices.bind(null, this)
        },
        availableInputDevices: {
            enumerable: true,
            value: availableInputDevices
        },
        availableOutputDevices: {
            enumerable: true,
            value: availableOutputDevices
        },
        inputDevice: {
            enumerable: true,
            get: function() {
                return self._inputDevice;
            }
        },
        inputStream: {
            enumerable: true,
            get: function() {
                return self._inputStream;
            }
        },
        isVolumeSupported: {
            enumerable: true,
            value: isVolumeSupported
        },
        isOutputSelectionSupported: {
            enumerable: true,
            value: isOutputSelectionSupported
        },
        ringtoneDevices: {
            enumerable: true,
            value: new OutputDeviceCollection("ringtone", availableOutputDevices, onActiveOutputsChanged, isOutputSelectionSupported)
        },
        speakerDevices: {
            enumerable: true,
            value: new OutputDeviceCollection("speaker", availableOutputDevices, onActiveOutputsChanged, isOutputSelectionSupported)
        }
    });
    this.on("newListener", function(eventName) {
        if (eventName === "inputVolume") {
            self._maybeStartPollingVolume();
        }
    });
    this.on("removeListener", function(eventName) {
        if (eventName === "inputVolume") {
            self._maybeStopPollingVolume();
        }
    });
    this.once("newListener", function() {
        if (!isOutputSelectionSupported) {
            console.warn("Warning: This browser does not support audio output selection.");
        }
        if (!isVolumeSupported) {
            console.warn("Warning: This browser does not support Twilio's volume indicator feature.");
        }
    });
    if (isEnumerationSupported) {
        initializeEnumeration(this);
    }
}

function initializeEnumeration(audio) {
    audio._mediaDevices.addEventListener("devicechange", audio._updateAvailableDevices);
    audio._mediaDevices.addEventListener("deviceinfochange", audio._updateAvailableDevices);
    updateAvailableDevices(audio).then(function() {
        if (!audio.isOutputSelectionSupported) {
            return;
        }
        audio.speakerDevices.set("default");
        audio.ringtoneDevices.set("default");
    });
}

inherits(AudioHelper, EventEmitter);

AudioHelper.prototype._maybeStartPollingVolume = function _maybeStartPollingVolume() {
    if (!this.isVolumeSupported || !this._inputStream) {
        return;
    }
    updateVolumeSource(this);
    if (this._isPollingInputVolume) {
        return;
    }
    var bufferLength = this._inputVolumeAnalyser.frequencyBinCount;
    var buffer = new Uint8Array(bufferLength);
    var self = this;
    this._isPollingInputVolume = true;
    requestAnimationFrame(function emitVolume() {
        if (!self._isPollingInputVolume) {
            return;
        }
        self._inputVolumeAnalyser.getByteFrequencyData(buffer);
        var inputVolume = util.average(buffer);
        self.emit("inputVolume", inputVolume / 255);
        requestAnimationFrame(emitVolume);
    });
};

AudioHelper.prototype._maybeStopPollingVolume = function _maybeStopPollingVolume() {
    if (!this.isVolumeSupported) {
        return;
    }
    if (!this._isPollingInputVolume || this._inputStream && this.listenerCount("inputVolume")) {
        return;
    }
    if (this._inputVolumeSource) {
        this._inputVolumeSource.disconnect();
        this._inputVolumeSource = null;
    }
    this._isPollingInputVolume = false;
};

AudioHelper.prototype.setInputDevice = function setInputDevice(deviceId) {
    if (util.isFirefox()) {
        return Promise.reject(new Error("Firefox does not currently support opening multiple " + "audio input tracks simultaneously, even across different tabs. As a result, " + "Device.audio.setInputDevice is disabled on Firefox until support is added.\n" + "Related BugZilla thread: https://bugzilla.mozilla.org/show_bug.cgi?id=1299324"));
    }
    if (typeof deviceId !== "string") {
        return Promise.reject(new Error("Must specify the device to set"));
    }
    var device = this.availableInputDevices.get(deviceId);
    if (!device) {
        return Promise.reject(new Error("Device not found: " + deviceId));
    }
    if (this._inputDevice && this._inputDevice.deviceId === deviceId && this._inputStream) {
        return Promise.resolve();
    }
    var self = this;
    return this._getUserMedia({
        audio: {
            deviceId: {
                exact: deviceId
            }
        }
    }).then(function onGetUserMediaSuccess(stream) {
        return self._onActiveInputChanged(stream).then(function() {
            replaceStream(self, stream);
            self._inputDevice = device;
            self._maybeStartPollingVolume();
        });
    });
};

AudioHelper.prototype.unsetInputDevice = function unsetInputDevice() {
    if (!this.inputDevice) {
        return Promise.resolve();
    }
    var self = this;
    return this._onActiveInputChanged(null).then(function() {
        replaceStream(self, null);
        self._inputDevice = null;
        self._maybeStopPollingVolume();
    });
};

AudioHelper.prototype._unbind = function _unbind() {
    this._mediaDevices.removeEventListener("devicechange", this._updateAvailableDevices);
    this._mediaDevices.removeEventListener("deviceinfochange", this._updateAvailableDevices);
};

function addOptionsToAudioHelper(audioHelper, options) {
    var dictionary = options.__dict__;
    if (!dictionary) {
        return;
    }
    function setValue(key, value) {
        if (typeof value !== "undefined") {
            dictionary[key] = value;
        }
        return dictionary[key];
    }
    Object.keys(dictionary).forEach(function(key) {
        audioHelper[key] = setValue.bind(null, key);
    });
}

function updateAvailableDevices(audio) {
    return audio._mediaDevices.enumerateDevices().then(function(devices) {
        updateDevices(audio, filterByKind(devices, "audiooutput"), audio.availableOutputDevices, removeLostOutput);
        updateDevices(audio, filterByKind(devices, "audioinput"), audio.availableInputDevices, removeLostInput);
    });
}

function removeLostOutput(audio, lostDevice) {
    return audio.speakerDevices._delete(lostDevice) | audio.ringtoneDevices._delete(lostDevice);
}

function removeLostInput(audio, lostDevice) {
    if (!audio.inputDevice || audio.inputDevice.deviceId !== lostDevice.deviceId) {
        return false;
    }
    replaceStream(audio, null);
    audio._inputDevice = null;
    audio._maybeStopPollingVolume();
    var defaultDevice = audio.availableInputDevices.get("default") || Array.from(audio.availableInputDevices.values())[0];
    if (defaultDevice) {
        audio.setInputDevice(defaultDevice.deviceId);
    }
    return true;
}

function filterByKind(devices, kind) {
    return devices.filter(function(device) {
        return device.kind === kind;
    });
}

function getDeviceId(device) {
    return device.deviceId;
}

function updateDevices(audio, updatedDevices, availableDevices, removeLostDevice) {
    var updatedDeviceIds = updatedDevices.map(getDeviceId);
    var knownDeviceIds = Array.from(availableDevices.values()).map(getDeviceId);
    var lostActiveDevices = [];
    var lostDeviceIds = util.difference(knownDeviceIds, updatedDeviceIds);
    lostDeviceIds.forEach(function(lostDeviceId) {
        var lostDevice = availableDevices.get(lostDeviceId);
        availableDevices.delete(lostDeviceId);
        if (removeLostDevice(audio, lostDevice)) {
            lostActiveDevices.push(lostDevice);
        }
    });
    var deviceChanged = false;
    updatedDevices.forEach(function(newDevice) {
        var existingDevice = availableDevices.get(newDevice.deviceId);
        var newMediaDeviceInfo = wrapMediaDeviceInfo(audio, newDevice);
        if (!existingDevice || existingDevice.label !== newMediaDeviceInfo.label) {
            availableDevices.set(newDevice.deviceId, newMediaDeviceInfo);
            deviceChanged = true;
        }
    });
    if (deviceChanged || lostDeviceIds.length) {
        audio.emit("deviceChange", lostActiveDevices);
    }
}

var kindAliases = {
        audiooutput: "Audio Output",
        audioinput: "Audio Input"
    };

function getUnknownDeviceIndex(audioHelper, mediaDeviceInfo) {
    var id = mediaDeviceInfo.deviceId;
    var kind = mediaDeviceInfo.kind;
    var unknownIndexes = audioHelper._unknownDeviceIndexes;
    if (!unknownIndexes[kind]) {
        unknownIndexes[kind] = {};
    }
    var index = unknownIndexes[kind][id];
    if (!index) {
        index = Object.keys(unknownIndexes[kind]).length + 1;
        unknownIndexes[kind][id] = index;
    }
    return index;
}

function wrapMediaDeviceInfo(audioHelper, mediaDeviceInfo) {
    var options = {
            deviceId: mediaDeviceInfo.deviceId,
            groupId: mediaDeviceInfo.groupId,
            kind: mediaDeviceInfo.kind,
            label: mediaDeviceInfo.label
        };
    if (!options.label) {
        if (options.deviceId === "default") {
            options.label = "Default";
        } else {
            var index = getUnknownDeviceIndex(audioHelper, mediaDeviceInfo);
            options.label = "Unknown " + kindAliases[options.kind] + " Device " + index;
        }
    }
    return new MediaDeviceInfoShim(options);
}

function updateVolumeSource(audioHelper) {
    if (audioHelper._inputVolumeSource) {
        audioHelper._inputVolumeSource.disconnect();
        audioHelper._inputVolumeSource = null;
    }
    audioHelper._inputVolumeSource = audioHelper._audioContext.createMediaStreamSource(audioHelper._inputStream);
    audioHelper._inputVolumeSource.connect(audioHelper._inputVolumeAnalyser);
}

function replaceStream(audio, stream) {
    if (audio._inputStream) {
        audio._inputStream.getTracks().forEach(function(track) {
            track.stop();
        });
    }
    audio._inputStream = stream;
}

module.exports = AudioHelper;