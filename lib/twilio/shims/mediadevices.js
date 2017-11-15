"use strict";

var EventTarget = require("./eventtarget");

var inherits = require("util").inherits;

var POLL_INTERVAL_MS = 500;

var nativeMediaDevices = typeof navigator !== "undefined" && navigator.mediaDevices;

function MediaDevicesShim() {
    EventTarget.call(this);
    this._defineEventHandler("devicechange");
    this._defineEventHandler("deviceinfochange");
    var knownDevices = [];
    Object.defineProperties(this, {
        _deviceChangeIsNative: {
            value: reemitNativeEvent(this, "devicechange")
        },
        _deviceInfoChangeIsNative: {
            value: reemitNativeEvent(this, "deviceinfochange")
        },
        _knownDevices: {
            value: knownDevices
        },
        _pollInterval: {
            value: null,
            writable: true
        }
    });
    if (typeof nativeMediaDevices.enumerateDevices === "function") {
        nativeMediaDevices.enumerateDevices().then(function(devices) {
            devices.sort(sortDevicesById).forEach([].push, knownDevices);
        });
    }
    this._eventEmitter.on("newListener", function maybeStartPolling(eventName) {
        if (eventName !== "devicechange" && eventName !== "deviceinfochange") {
            return;
        }
        this._pollInterval = this._pollInterval || setInterval(sampleDevices.bind(null, this), POLL_INTERVAL_MS);
    }.bind(this));
    this._eventEmitter.on("removeListener", function maybeStopPolling() {
        if (this._pollInterval && !hasChangeListeners(this)) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }.bind(this));
}

inherits(MediaDevicesShim, EventTarget);

if (nativeMediaDevices && typeof nativeMediaDevices.enumerateDevices === "function") {
    MediaDevicesShim.prototype.enumerateDevices = function enumerateDevices() {
        return nativeMediaDevices.enumerateDevices.apply(nativeMediaDevices, arguments);
    };
}

MediaDevicesShim.prototype.getUserMedia = function getUserMedia() {
    return nativeMediaDevices.getUserMedia.apply(nativeMediaDevices, arguments);
};

function deviceInfosHaveChanged(newDevices, oldDevices) {
    var oldLabels = oldDevices.reduce(function(map, device) {
            return map.set(device.deviceId, device.label || null);
        }, new Map());
    return newDevices.some(function(newDevice) {
        var oldLabel = oldLabels.get(newDevice.deviceId);
        return typeof oldLabel !== "undefined" && oldLabel !== newDevice.label;
    });
}

function devicesHaveChanged(newDevices, oldDevices) {
    return newDevices.length !== oldDevices.length || propertyHasChanged("deviceId", newDevices, oldDevices);
}

function hasChangeListeners(mediaDevices) {
    return [ "devicechange", "deviceinfochange" ].reduce(function(count, event) {
        return count + mediaDevices._eventEmitter.listenerCount(event);
    }, 0) > 0;
}

function sampleDevices(mediaDevices) {
    nativeMediaDevices.enumerateDevices().then(function(newDevices) {
        var knownDevices = mediaDevices._knownDevices;
        var oldDevices = knownDevices.slice();
        [].splice.apply(knownDevices, [ 0, knownDevices.length ].concat(newDevices.sort(sortDevicesById)));
        if (!mediaDevices._deviceChangeIsNative && devicesHaveChanged(knownDevices, oldDevices)) {
            mediaDevices.dispatchEvent(new Event("devicechange"));
        }
        if (!mediaDevices._deviceInfoChangeIsNative && deviceInfosHaveChanged(knownDevices, oldDevices)) {
            mediaDevices.dispatchEvent(new Event("deviceinfochange"));
        }
    });
}

function propertyHasChanged(propertyName, as, bs) {
    return as.some(function(a, i) {
        return a[propertyName] !== bs[i][propertyName];
    });
}

function reemitNativeEvent(mediaDevices, eventName) {
    var methodName = "on" + eventName;
    function dispatchEvent(event) {
        mediaDevices.dispatchEvent(event);
    }
    if (methodName in nativeMediaDevices) {
        if ("addEventListener" in nativeMediaDevices) {
            nativeMediaDevices.addEventListener(eventName, dispatchEvent);
        } else {
            nativeMediaDevices[methodName] = dispatchEvent;
        }
        return true;
    }
    return false;
}

function sortDevicesById(a, b) {
    return a.deviceId < b.deviceId;
}

module.exports = function shimMediaDevices() {
    if (nativeMediaDevices) {
        return new MediaDevicesShim();
    } else {
        return null;
    }
}();