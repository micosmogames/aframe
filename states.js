/*
*  states.js
*
*  Component that manages the transition between application states that are defined on an element.
*  Multiple states components can be specified allowing localised state management. The main states
*  component would typically be located on the scene.
*
*  The transitions between states are initiated within the application itself by calling component
*  methods on a target states component. The states component supports multiple instances so can be
*  assigned unique ids.
*
*  Schema: {
*     list: An array or one or more state names for this state management component.
*     dispersePattern: Method pattern for disperseEvent. %A for action and %S for the state
*     changeEvent: Name of the change event.
*
*  Events are non bubbling and are emitted to the states element.
*  The event detail object:
*     {
*       disperseEvent: <meth>, // Default method to disperse the event.
*       states: <object>, // The owning states component object of this event detail.
*       from: <object>, // Object defining the 'from' state context.
*       to: <object>, // Object defining the 'to' state context.
*       op: 'chain' | 'call' | 'return'
*     }
*  from/to object:
*     {
*       state: <state>, // The transition state.
*       action: 'enter' | 'exit' | <user defined>, // The transition action.
*       <name>: <value>, // User defined name/values for the event.
*     }
*  User defined action and name/value pairs are passed to the chain, call, return operations.
*/
"use strict";

import aframe from 'aframe';
import { requestObject, returnObject } from '@micosmo/core/object';
import { declareMethods, method, methodNameBuilder } from '@micosmo/core/method';
import { parseNameValues } from '@micosmo/core/string';
import { copyValues } from '@micosmo/core/replicate';
import { Threadlet } from '@micosmo/async/threadlet';
import { createSchemaPersistentObject } from './lib/utils';

declareMethods(disperseEvent);

aframe.registerComponent("states", {
  schema: {
    list: { default: [] },
    dispersePattern: { default: '%A%S' }, // Pattern for generic state handler model. %A - action, %S - state
    event: { default: 'statechanged' },
  },
  updateSchema(data) {
    createSchemaPersistentObject(this, data, '_state');
  },
  multiple: true,
  init() {
    this.intState = this.data._state;
    this.intState.currentState = undefined;
    this.callStack = [];
  },
  update() {
    if (!this.data.event)
      throw new Error(`micosmo:component:states:update: 'event' name is required.`);
    if (!this.data.dispersePattern)
      throw new Error(`micosmo:component:states:update: 'dispersePattern' is required.`);
    this.fDisperseMethod = methodNameBuilder(this.data.dispersePattern, /%A/, /%S/);
  },
  chain(state, fromCtxt, toCtxt) {
    Threadlet.DefaultPriority.run(() => { emitStateChange(this, this.intState.currentState, state, fromCtxt, toCtxt, 'chain') });
  },
  call(state, fromCtxt, toCtxt) {
    Threadlet.DefaultPriority.run(() => { callAndEmit(this, state, fromCtxt, toCtxt) });
  },
  return(state, fromCtxt, toCtxt) {
    Threadlet.DefaultPriority.run(() => { returnAndEmit(this, state, fromCtxt, toCtxt) });
  },
  syncChain(state, fromCtxt, toCtxt) { emitStateChange(this, this.intState.currentState, state, fromCtxt, toCtxt, 'chain') },
  syncCall(state, fromCtxt, toCtxt) { callAndEmit(this, state, fromCtxt, toCtxt) },
  syncReturn(state, fromCtxt, toCtxt) { returnAndEmit(this, state, fromCtxt, toCtxt) },
});

function callAndEmit(states, state, fromCtxt, toCtxt) {
  const curState = states.intState.currentState;
  states.callStack.push(curState);
  emitStateChange(states, curState, state, fromCtxt, toCtxt, 'call');
}

function returnAndEmit(states, state, fromCtxt, toCtxt) {
  if (states.callStack.length === 0)
    throw new Error(`micosmo:component:states:returnAndEmit: Call stack is empty.`);
  const oldState = states.callStack.pop();
  emitStateChange(states, states.intState.currentState, state || oldState, fromCtxt, toCtxt, 'return');
}

function emitStateChange(states, fromState, toState, fromCtxt, toCtxt, op) {
  if (!states.data.list.includes(toState))
    throw new Error(`micosmo:component:states:emitStateChange: State '${toState}' is not defined`);

  const evtDetail = requestObject();
  evtDetail.disperseEvent = disperseEvent; evtDetail.states = states; evtDetail.op = op;
  evtDetail.from = createContextObject(fromCtxt, fromState, 'exit');
  evtDetail.to = createContextObject(toCtxt, toState, 'enter');

  states.intState.currentState = toState;
  states.el.emit(states.data.event, evtDetail, false);
  returnObject(evtDetail); // Will automatically cleanup from/to context objects
}

function createContextObject(ctxt, state, defAction) {
  const oCtxt = requestObject();
  oCtxt.state = state || '<nos>';
  if (ctxt) typeof ctxt === 'string' ? parseNameValues(ctxt, oCtxt) : copyValues(ctxt, oCtxt);
  if (!oCtxt.action) oCtxt.action = defAction;
  return oCtxt;
}

method(disperseEvent);
function disperseEvent(evt, oTgt) {
  const fDisperseMethod = this.states.fDisperseMethod;
  disperseMethod(fDisperseMethod, evt, oTgt, this.from);
  disperseMethod(fDisperseMethod, evt, oTgt, this.to);
}

function disperseMethod(fDisperseMethod, evt, oTgt, oCtxt) {
  let sMeth = fDisperseMethod(oCtxt.action, oCtxt.state);
  if (oTgt[sMeth]) return oTgt[sMeth](evt);
  if (!oCtxt.defaultAction) return;
  sMeth = fDisperseMethod(oCtxt.defaultAction, oCtxt.state);
  if (oTgt[sMeth]) oTgt[sMeth](evt);
}
