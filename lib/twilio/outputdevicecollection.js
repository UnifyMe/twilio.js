"use strict";

var util = require("./util");

var DEFAULT_TEST_SOUND_URL = util.getTwilioRoot() + "sounds/releases/" + util.getSoundVersion() + "/outgoing.mp3";

function OutputDeviceCollection(name, availableDevices, beforeChange, isSupported) {
    Object.defineProperties(this, {
        _activeDevices: {
            value: new Set()
        },
        _availableDevices: {
            value: availableDevices
        },
        _beforeChange: {
            value: beforeChange
        },
        _isSupported: {
            value: isSupported
        },
        _name: {
            value: name
        }
    });
}

OutputDeviceCollection.prototype._delete = function _delete(device) {
    var wasDeleted = this._activeDevices.delete(device);
    if (!this._activeDevices.size) {
        this._activeDevices.add(this._availableDevices.get("default"));
    }
    var deviceIds = Array.from(this._activeDevices).map(function(deviceInfo) {
            return deviceInfo.deviceId;
        });
    this._beforeChange(this._name, deviceIds);
    return wasDeleted;
};

OutputDeviceCollection.prototype.get = function get() {
    return this._activeDevices;
};

OutputDeviceCollection.prototype.set = function set(deviceIds) {
    if (!this._isSupported) {
        return Promise.reject(new Error("This browser does not support audio output selection"));
    }
    deviceIds = Array.isArray(deviceIds) ? deviceIds : [ deviceIds ];
    if (!deviceIds.length) {
        return Promise.reject(new Error("Must specify at least one device to set"));
    }
    var missingIds = [];
    var devices = deviceIds.map(function(id) {
            var device = this._availableDevices.get(id);
            if (!device) {
                missingIds.push(id);
            }
            return device;
        }, this);
    if (missingIds.length) {
        return Promise.reject(new Error("Devices not found: ", missingIds.join(", ")));
    }
    var self = this;
    function updateDevices() {
        self._activeDevices.clear();
        devices.forEach(self._activeDevices.add, self._activeDevices);
    }
    return new Promise(function(resolve) {
        resolve(self._beforeChange(self._name, deviceIds));
    }).then(updateDevices);
};

OutputDeviceCollection.prototype.test = function test(soundUrl) {
    if (!this._isSupported) {
        return Promise.reject(new Error("This browser does not support audio output selection"));
    }
    soundUrl = soundUrl || DEFAULT_TEST_SOUND_URL;
    if (!this._activeDevices.size) {
        return Promise.reject(new Error("No active output devices to test"));
    }
    return Promise.all(Array.from(this._activeDevices).map(function(device) {
        var el = new Audio([ soundUrl ]);
        return el.setSinkId(device.deviceId).then(function() {
            return el.play();
        });
    }));
};

module.exports = OutputDeviceCollection;