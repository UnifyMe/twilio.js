"use strict";

exports.SOUNDS_DEPRECATION_WARNING = "Device.sounds is deprecated and will be removed in the next breaking " + "release. Please use the new functionality available on Device.audio.";

function generateEventWarning(event, name, maxListeners) {
    return "The number of " + event + " listeners on " + name + " " + "exceeds the recommended number of " + maxListeners + ". " + "While twilio.js will continue to function normally, this " + "may be indicative of an application error. Note that " + event + " listeners exist for the lifetime of the " + name + ".";
}

exports.generateEventWarning = generateEventWarning;