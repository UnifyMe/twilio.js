"use strict";

function MediaDeviceInfoShim(options) {
    Object.defineProperties(this, {
        deviceId: {
            get: function() {
                return options.deviceId;
            }
        },
        groupId: {
            get: function() {
                return options.groupId;
            }
        },
        kind: {
            get: function() {
                return options.kind;
            }
        },
        label: {
            get: function() {
                return options.label;
            }
        }
    });
}

module.exports = MediaDeviceInfoShim;