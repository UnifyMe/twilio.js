"use strict";

(function(root) {
    var Twilio = root.Twilio || {};
    Object.assign(Twilio, require("./twilio"));
    root.Twilio = Twilio;
})(typeof window !== "undefined" ? window : global);
