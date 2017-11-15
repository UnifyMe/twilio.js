"use strict";

var MockRTCStatsReport = require("./mockrtcstatsreport");

var ERROR_PEER_CONNECTION_NULL = "PeerConnection is null";

var ERROR_WEB_RTC_UNSUPPORTED = "WebRTC statistics are unsupported";

var SIGNED_SHORT = 32767;

var isChrome = false;

if (typeof window !== "undefined") {
    var isCriOS = !!window.navigator.userAgent.match("CriOS");
    var isElectron = !!window.navigator.userAgent.match("Electron");
    var isGoogle = typeof window.chrome !== "undefined" && window.navigator.vendor === "Google Inc." && window.navigator.userAgent.indexOf("OPR") === -1 && window.navigator.userAgent.indexOf("Edge") === -1;
    isChrome = isCriOS || isElectron || isGoogle;
}

function getStatistics(peerConnection, options) {
    options = Object.assign({
        createRTCSample: createRTCSample
    }, options);
    if (!peerConnection) {
        return Promise.reject(new Error(ERROR_PEER_CONNECTION_NULL));
    }
    if (typeof peerConnection.getStats !== "function") {
        return Promise.reject(new Error(ERROR_WEB_RTC_UNSUPPORTED));
    }
    if (isChrome) {
        return new Promise(function(resolve, reject) {
            return peerConnection.getStats(resolve, reject);
        }).then(MockRTCStatsReport.fromRTCStatsResponse).then(options.createRTCSample);
    }
    var promise;
    try {
        promise = peerConnection.getStats();
    } catch (e) {
        promise = new Promise(function(resolve, reject) {
            return peerConnection.getStats(resolve, reject);
        }).then(MockRTCStatsReport.fromRTCStatsResponse);
    }
    return promise.then(options.createRTCSample);
}

function RTCSample() {}

function createRTCSample(statsReport) {
    var activeTransportId = null;
    var sample = new RTCSample();
    Array.from(statsReport.values()).forEach(function(stats) {
        var type = stats.type.replace("-", "");
        switch (type) {
          case "inboundrtp":
            sample.timestamp = stats.timestamp;
            sample.jitter = stats.jitter * 1e3;
            sample.packetsLost = stats.packetsLost;
            sample.packetsReceived = stats.packetsReceived;
            sample.bytesReceived = stats.bytesReceived;
            var inboundTrack = statsReport.get(stats.trackId);
            if (inboundTrack) {
                sample.audioOutputLevel = inboundTrack.audioLevel * SIGNED_SHORT;
            }
            break;

          case "outboundrtp":
            sample.packetsSent = stats.packetsSent;
            sample.bytesSent = stats.bytesSent;
            if (stats.codecId && statsReport.get(stats.codecId)) {
                var mimeType = statsReport.get(stats.codecId).mimeType;
                sample.codecName = mimeType && mimeType.match(/(.*\/)?(.*)/)[2];
            }
            var outboundTrack = statsReport.get(stats.trackId);
            if (outboundTrack) {
                sample.audioInputLevel = outboundTrack.audioLevel * SIGNED_SHORT;
            }
            break;

          case "transport":
            if (stats.dtlsState === "connected") {
                activeTransportId = stats.id;
            }
            break;
        }
    });
    var activeTransport = statsReport.get(activeTransportId);
    if (!activeTransport) {
        return sample;
    }
    var selectedCandidatePair = statsReport.get(activeTransport.selectedCandidatePairId);
    if (!selectedCandidatePair) {
        return sample;
    }
    var localCandidate = statsReport.get(selectedCandidatePair.localCandidateId);
    var remoteCandidate = statsReport.get(selectedCandidatePair.remoteCandidateId);
    Object.assign(sample, {
        localAddress: localCandidate && localCandidate.ip,
        remoteAddress: remoteCandidate && remoteCandidate.ip,
        rtt: selectedCandidatePair && selectedCandidatePair.currentRoundTripTime * 1e3
    });
    return sample;
}

module.exports = getStatistics;