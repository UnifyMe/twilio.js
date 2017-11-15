"use strict";

(function(root) {
    var Twilio = root.Twilio || function Twilio() {};
    Object.assign(Twilio, require("./twilio"));
    root.Twilio = Twilio;
})(typeof window !== "undefined" ? window : global);