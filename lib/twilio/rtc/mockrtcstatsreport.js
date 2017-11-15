"use strict";

var OLD_MAX_VOLUME = 32767;

var NativeRTCStatsReport = typeof window !== "undefined" ? window.RTCStatsReport : undefined;

function MockRTCStatsReport(statsMap) {
    if (!(this instanceof MockRTCStatsReport)) {
        return new MockRTCStatsReport(statsMap);
    }
    var self = this;
    Object.defineProperties(this, {
        size: {
            enumerable: true,
            get: function() {
                return self._map.size;
            }
        },
        _map: {
            value: statsMap
        }
    });
    this[Symbol.iterator] = statsMap[Symbol.iterator];
}

if (NativeRTCStatsReport) {
    MockRTCStatsReport.prototype = Object.create(NativeRTCStatsReport.prototype);
    MockRTCStatsReport.prototype.constructor = MockRTCStatsReport;
}

[ "entries", "forEach", "get", "has", "keys", "values" ].forEach(function(key) {
    MockRTCStatsReport.prototype[key] = function() {
        return this._map[key].apply(this._map, arguments);
    };
});

MockRTCStatsReport.fromArray = function fromArray(array) {
    return new MockRTCStatsReport(array.reduce(function(map, rtcStats) {
        map.set(rtcStats.id, rtcStats);
        return map;
    }, new Map()));
};

MockRTCStatsReport.fromRTCStatsResponse = function fromRTCStatsResponse(statsResponse) {
    var activeCandidatePairId;
    var transportIds = new Map();
    var statsMap = statsResponse.result().reduce(function(statsMap, report) {
            var id = report.id;
            switch (report.type) {
              case "googCertificate":
                statsMap.set(id, createRTCCertificateStats(report));
                break;

              case "datachannel":
                statsMap.set(id, createRTCDataChannelStats(report));
                break;

              case "googCandidatePair":
                if (getBoolean(report, "googActiveConnection")) {
                    activeCandidatePairId = id;
                }
                statsMap.set(id, createRTCIceCandidatePairStats(report));
                break;

              case "localcandidate":
                statsMap.set(id, createRTCIceCandidateStats(report, false));
                break;

              case "remotecandidate":
                statsMap.set(id, createRTCIceCandidateStats(report, true));
                break;

              case "ssrc":
                if (isPresent(report, "packetsReceived")) {
                    statsMap.set("rtp-" + id, createRTCInboundRTPStreamStats(report));
                } else {
                    statsMap.set("rtp-" + id, createRTCOutboundRTPStreamStats(report));
                }
                statsMap.set("track-" + id, createRTCMediaStreamTrackStats(report));
                statsMap.set("codec-" + id, createRTCCodecStats(report));
                break;

              case "googComponent":
                var transportReport = createRTCTransportStats(report);
                transportIds.set(transportReport.selectedCandidatePairId, id);
                statsMap.set(id, createRTCTransportStats(report));
                break;
            }
            return statsMap;
        }, new Map());
    if (activeCandidatePairId) {
        var activeTransportId = transportIds.get(activeCandidatePairId);
        if (activeTransportId) {
            statsMap.get(activeTransportId).dtlsState = "connected";
        }
    }
    return new MockRTCStatsReport(statsMap);
};

function createRTCTransportStats(report) {
    return {
        type: "transport",
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        bytesSent: undefined,
        bytesReceived: undefined,
        rtcpTransportStatsId: undefined,
        dtlsState: undefined,
        selectedCandidatePairId: report.stat("selectedCandidatePairId"),
        localCertificateId: report.stat("localCertificateId"),
        remoteCertificateId: report.stat("remoteCertificateId")
    };
}

function createRTCCodecStats(report) {
    return {
        type: "codec",
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        payloadType: undefined,
        mimeType: report.stat("mediaType") + "/" + report.stat("googCodecName"),
        clockRate: undefined,
        channels: undefined,
        sdpFmtpLine: undefined,
        implementation: undefined
    };
}

function createRTCMediaStreamTrackStats(report) {
    return {
        type: "track",
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        trackIdentifier: report.stat("googTrackId"),
        remoteSource: undefined,
        ended: undefined,
        kind: report.stat("mediaType"),
        detached: undefined,
        ssrcIds: undefined,
        frameWidth: isPresent(report, "googFrameWidthReceived") ? getInt(report, "googFrameWidthReceived") : getInt(report, "googFrameWidthSent"),
        frameHeight: isPresent(report, "googFrameHeightReceived") ? getInt(report, "googFrameHeightReceived") : getInt(report, "googFrameHeightSent"),
        framesPerSecond: undefined,
        framesSent: getInt(report, "framesEncoded"),
        framesReceived: undefined,
        framesDecoded: getInt(report, "framesDecoded"),
        framesDropped: undefined,
        framesCorrupted: undefined,
        partialFramesLost: undefined,
        fullFramesLost: undefined,
        audioLevel: isPresent(report, "audioOutputLevel") ? getInt(report, "audioOutputLevel") / OLD_MAX_VOLUME : (getInt(report, "audioInputLevel") || 0) / OLD_MAX_VOLUME,
        echoReturnLoss: getFloat(report, "googEchoCancellationReturnLoss"),
        echoReturnLossEnhancement: getFloat(report, "googEchoCancellationReturnLossEnhancement")
    };
}

function createRTCRTPStreamStats(report, isInbound) {
    return {
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        ssrc: report.stat("ssrc"),
        associateStatsId: undefined,
        isRemote: undefined,
        mediaType: report.stat("mediaType"),
        trackId: "track-" + report.id,
        transportId: report.stat("transportId"),
        codecId: "codec-" + report.id,
        firCount: isInbound ? getInt(report, "googFirsSent") : undefined,
        pliCount: isInbound ? getInt(report, "googPlisSent") : getInt(report, "googPlisReceived"),
        nackCount: isInbound ? getInt(report, "googNacksSent") : getInt(report, "googNacksReceived"),
        sliCount: undefined,
        qpSum: getInt(report, "qpSum")
    };
}

function createRTCInboundRTPStreamStats(report) {
    var rtp = createRTCRTPStreamStats(report, true);
    Object.assign(rtp, {
        type: "inbound-rtp",
        packetsReceived: getInt(report, "packetsReceived"),
        bytesReceived: getInt(report, "bytesReceived"),
        packetsLost: getInt(report, "packetsLost"),
        jitter: convertMsToSeconds(report.stat("googJitterReceived")),
        fractionLost: undefined,
        roundTripTime: convertMsToSeconds(report.stat("googRtt")),
        packetsDiscarded: undefined,
        packetsRepaired: undefined,
        burstPacketsLost: undefined,
        burstPacketsDiscarded: undefined,
        burstLossCount: undefined,
        burstDiscardCount: undefined,
        burstLossRate: undefined,
        burstDiscardRate: undefined,
        gapLossRate: undefined,
        gapDiscardRate: undefined,
        framesDecoded: getInt(report, "framesDecoded")
    });
    return rtp;
}

function createRTCOutboundRTPStreamStats(report) {
    var rtp = createRTCRTPStreamStats(report, false);
    Object.assign(rtp, {
        type: "outbound-rtp",
        remoteTimestamp: undefined,
        packetsSent: getInt(report, "packetsSent"),
        bytesSent: getInt(report, "bytesSent"),
        targetBitrate: undefined,
        framesEncoded: getInt(report, "framesEncoded")
    });
    return rtp;
}

function createRTCIceCandidateStats(report, isRemote) {
    return {
        type: isRemote ? "remote-candidate" : "local-candidate",
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        transportId: undefined,
        isRemote: isRemote,
        ip: report.stat("ipAddress"),
        port: getInt(report, "portNumber"),
        protocol: report.stat("transport"),
        candidateType: translateCandidateType(report.stat("candidateType")),
        priority: getFloat(report, "priority"),
        url: undefined,
        relayProtocol: undefined,
        deleted: undefined
    };
}

function createRTCIceCandidatePairStats(report) {
    return {
        type: "candidate-pair",
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        transportId: report.stat("googChannelId"),
        localCandidateId: report.stat("localCandidateId"),
        remoteCandidateId: report.stat("remoteCandidateId"),
        state: undefined,
        priority: undefined,
        nominated: undefined,
        writable: getBoolean(report, "googWritable"),
        readable: undefined,
        bytesSent: getInt(report, "bytesSent"),
        bytesReceived: getInt(report, "bytesReceived"),
        lastPacketSentTimestamp: undefined,
        lastPacketReceivedTimestamp: undefined,
        totalRoundTripTime: undefined,
        currentRoundTripTime: convertMsToSeconds(report.stat("googRtt")),
        availableOutgoingBitrate: undefined,
        availableIncomingBitrate: undefined,
        requestsReceived: getInt(report, "requestsReceived"),
        requestsSent: getInt(report, "requestsSent"),
        responsesReceived: getInt(report, "responsesReceived"),
        responsesSent: getInt(report, "responsesSent"),
        retransmissionsReceived: undefined,
        retransmissionsSent: undefined,
        consentRequestsSent: getInt(report, "consentRequestsSent")
    };
}

function createRTCCertificateStats(report) {
    return {
        type: "certificate",
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        fingerprint: report.stat("googFingerprint"),
        fingerprintAlgorithm: report.stat("googFingerprintAlgorithm"),
        base64Certificate: report.stat("googDerBase64"),
        issuerCertificateId: report.stat("googIssuerId")
    };
}

function createRTCDataChannelStats(report) {
    return {
        type: "data-channel",
        id: report.id,
        timestamp: Date.parse(report.timestamp),
        label: report.stat("label"),
        protocol: report.stat("protocol"),
        datachannelid: report.stat("datachannelid"),
        transportId: report.stat("transportId"),
        state: report.stat("state"),
        messagesSent: undefined,
        bytesSent: undefined,
        messagesReceived: undefined,
        bytesReceived: undefined
    };
}

function convertMsToSeconds(inMs) {
    if (isNaN(inMs) || inMs === "") {
        return undefined;
    } else {
        return parseInt(inMs, 10) / 1e3;
    }
}

function translateCandidateType(type) {
    switch (type) {
      case "peerreflexive":
        return "prflx";

      case "serverreflexive":
        return "srflx";

      case "host":
      case "relay":
      default:
        return type;
    }
}

function getInt(report, statName) {
    var stat = report.stat(statName);
    if (isPresent(report, statName)) {
        return parseInt(stat, 10);
    } else {
        return undefined;
    }
}

function getFloat(report, statName) {
    var stat = report.stat(statName);
    if (isPresent(report, statName)) {
        return parseFloat(stat);
    } else {
        return undefined;
    }
}

function getBoolean(report, statName) {
    var stat = report.stat(statName);
    if (isPresent(report, statName)) {
        return stat === "true" || stat === true;
    } else {
        return undefined;
    }
}

function isPresent(report, statName) {
    var stat = report.stat(statName);
    return typeof stat !== "undefined" && stat !== "";
}

module.exports = MockRTCStatsReport;