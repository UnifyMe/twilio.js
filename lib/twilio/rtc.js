"use strict";

var PeerConnection = require("./peerconnection");

function enabled(set) {
    if (typeof set !== "undefined") {
        PeerConnection.enabled = set;
    }
    return PeerConnection.enabled;
}

function getMediaEngine() {
    if (typeof RTCIceGatherer !== "undefined") {
        return "ORTC";
    } else {
        return "WebRTC";
    }
}

module.exports = {
    enabled: enabled,
    getMediaEngine: getMediaEngine,
    PeerConnection: PeerConnection
};