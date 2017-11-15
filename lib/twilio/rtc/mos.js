"use strict";

var rfactorConstants = {
        r0: 94.768,
        is: 1.42611
    };

function calcMos(sample, fractionLost) {
    if (!sample || !isPositiveNumber(sample.rtt) || !isPositiveNumber(sample.jitter) || !isPositiveNumber(fractionLost)) {
        return null;
    }
    var rFactor = calculateRFactor(sample.rtt, sample.jitter, fractionLost);
    var mos = 1 + .035 * rFactor + 7e-6 * rFactor * (rFactor - 60) * (100 - rFactor);
    var isValid = mos >= 1 && mos < 4.6;
    if (isValid) {
        return mos;
    } else {
        return null;
    }
}

function calculateRFactor(rtt, jitter, fractionLost) {
    var effectiveLatency = rtt + jitter * 2 + 10;
    var rFactor = 0;
    switch (true) {
      case effectiveLatency < 160:
        rFactor = rfactorConstants.r0 - effectiveLatency / 40;
        break;

      case effectiveLatency < 1e3:
        rFactor = rfactorConstants.r0 - (effectiveLatency - 120) / 10;
        break;

      case effectiveLatency >= 1e3:
        rFactor = rfactorConstants.r0 - effectiveLatency / 100;
        break;
    }
    var multiplier = .01;
    switch (true) {
      case fractionLost === -1:
        multiplier = 0;
        rFactor = 0;
        break;

      case fractionLost <= rFactor / 2.5:
        multiplier = 2.5;
        break;

      case fractionLost > rFactor / 2.5 && fractionLost < 100:
        multiplier = .25;
        break;
    }
    rFactor -= fractionLost * multiplier;
    return rFactor;
}

function isPositiveNumber(n) {
    return typeof n === "number" && !isNaN(n) && isFinite(n) && n >= 0;
}

module.exports = {
    calculate: calcMos
};