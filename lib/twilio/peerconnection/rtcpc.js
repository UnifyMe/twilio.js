"use strict";

var ortcAdapter = require("ortc-adapter");

var util = require("../util");

function RTCPC() {
    if (typeof window === "undefined") {
        this.log("No RTCPeerConnection implementation available. The window object was not found.");
        return;
    }
    if (util.isEdge()) {
        this.RTCPeerConnection = ortcAdapter.RTCPeerConnection;
        window.RTCSessionDescription = ortcAdapter.RTCSessionDescription;
        window.RTCIceCandidate = ortcAdapter.RTCIceCandidate;
    } else if (typeof window.RTCPeerConnection === "function") {
        this.RTCPeerConnection = window.RTCPeerConnection;
    } else if (typeof window.webkitRTCPeerConnection === "function") {
        this.RTCPeerConnection = webkitRTCPeerConnection;
    } else if (typeof window.mozRTCPeerConnection === "function") {
        this.RTCPeerConnection = mozRTCPeerConnection;
        window.RTCSessionDescription = mozRTCSessionDescription;
        window.RTCIceCandidate = mozRTCIceCandidate;
    } else {
        this.log("No RTCPeerConnection implementation available");
    }
}

RTCPC.prototype.create = function(log, rtcConstraints, iceServers) {
    this.log = log;
    this.pc = new this.RTCPeerConnection({
        iceServers: iceServers
    }, rtcConstraints);
};

RTCPC.prototype.createModernConstraints = function(c) {
    if (typeof c === "undefined") {
        return null;
    }
    var nc = {};
    if (typeof webkitRTCPeerConnection !== "undefined") {
        nc.mandatory = {};
        if (typeof c.audio !== "undefined") {
            nc.mandatory.OfferToReceiveAudio = c.audio;
        }
        if (typeof c.video !== "undefined") {
            nc.mandatory.OfferToReceiveVideo = c.video;
        }
    } else {
        if (typeof c.audio !== "undefined") {
            nc.offerToReceiveAudio = c.audio;
        }
        if (typeof c.video !== "undefined") {
            nc.offerToReceiveVideo = c.video;
        }
    }
    return nc;
};

RTCPC.prototype.createOffer = function(constraints, onSuccess, onError) {
    var self = this;
    constraints = this.createModernConstraints(constraints);
    promisifyCreate(this.pc.createOffer, this.pc)(constraints).then(function(sd) {
        return self.pc && promisifySet(self.pc.setLocalDescription, self.pc)(new RTCSessionDescription(sd));
    }).then(onSuccess, onError);
};

RTCPC.prototype.createAnswer = function(constraints, onSuccess, onError) {
    var self = this;
    constraints = this.createModernConstraints(constraints);
    promisifyCreate(this.pc.createAnswer, this.pc)(constraints).then(function(sd) {
        return self.pc && promisifySet(self.pc.setLocalDescription, self.pc)(new RTCSessionDescription(sd));
    }).then(onSuccess, onError);
};

RTCPC.prototype.processSDP = function(sdp, constraints, onSuccess, onError) {
    var self = this;
    var desc = new RTCSessionDescription({
            sdp: sdp,
            type: "offer"
        });
    promisifySet(this.pc.setRemoteDescription, this.pc)(desc).then(function() {
        self.createAnswer(constraints, onSuccess, onError);
    });
};

RTCPC.prototype.getSDP = function() {
    return this.pc.localDescription.sdp;
};

RTCPC.prototype.processAnswer = function(sdp, onSuccess, onError) {
    if (!this.pc) {
        return;
    }
    promisifySet(this.pc.setRemoteDescription, this.pc)(new RTCSessionDescription({
        sdp: sdp,
        type: "answer"
    })).then(onSuccess, onError);
};

RTCPC.test = function() {
    if (typeof navigator === "object") {
        var getUserMedia = navigator.mediaDevices && navigator.mediaDevices.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.getUserMedia;
        if (getUserMedia && typeof window.RTCPeerConnection === "function") {
            return true;
        } else if (getUserMedia && typeof window.webkitRTCPeerConnection === "function") {
            return true;
        } else if (getUserMedia && typeof window.mozRTCPeerConnection === "function") {
            try {
                var test = new window.mozRTCPeerConnection();
                if (typeof test.getLocalStreams !== "function") {
                    return false;
                }
            } catch (e) {
                return false;
            }
            return true;
        } else if (typeof RTCIceGatherer !== "undefined") {
            return true;
        }
    }
    return false;
};

function promisify(fn, ctx, areCallbacksFirst) {
    return function() {
        var args = Array.prototype.slice.call(arguments);
        return new Promise(function(resolve) {
            resolve(fn.apply(ctx, args));
        }).catch(function() {
            return new Promise(function(resolve, reject) {
                fn.apply(ctx, areCallbacksFirst ? [ resolve, reject ].concat(args) : args.concat([ resolve, reject ]));
            });
        });
    };
}

function promisifyCreate(fn, ctx) {
    return promisify(fn, ctx, true);
}

function promisifySet(fn, ctx) {
    return promisify(fn, ctx, false);
}

module.exports = RTCPC;