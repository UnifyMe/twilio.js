"use strict";

var inherits = require("util").inherits;

function StateMachine(states, initialState) {
    if (!(this instanceof StateMachine)) {
        return new StateMachine(states, initialState);
    }
    var currentState = initialState;
    Object.defineProperties(this, {
        _currentState: {
            get: function() {
                return currentState;
            },
            set: function(_currentState) {
                currentState = _currentState;
            }
        },
        currentState: {
            enumerable: true,
            get: function() {
                return currentState;
            }
        },
        states: {
            enumerable: true,
            value: states
        },
        transitions: {
            enumerable: true,
            value: []
        }
    });
    Object.freeze(this);
}

StateMachine.prototype.transition = function transition(to) {
    var from = this.currentState;
    var valid = this.states[from];
    var newTransition = valid && valid.indexOf(to) !== -1 ? new StateTransition(from, to) : new InvalidStateTransition(from, to);
    this.transitions.push(newTransition);
    this._currentState = to;
    if (newTransition instanceof InvalidStateTransition) {
        throw newTransition;
    }
    return this;
};

function StateTransition(from, to) {
    Object.defineProperties(this, {
        from: {
            enumerable: true,
            value: from
        },
        to: {
            enumerable: true,
            value: to
        }
    });
}

function InvalidStateTransition(from, to) {
    if (!(this instanceof InvalidStateTransition)) {
        return new InvalidStateTransition(from, to);
    }
    Error.call(this);
    StateTransition.call(this, from, to);
    var errorMessage = "Invalid transition from " + (typeof from === "string" ? '"' + from + '"' : "null") + ' to "' + to + '"';
    Object.defineProperties(this, {
        message: {
            enumerable: true,
            value: errorMessage
        }
    });
    Object.freeze(this);
}

inherits(InvalidStateTransition, Error);

module.exports = StateMachine;