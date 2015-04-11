'use strict';
let Rx = require('rx');
let InputProxy = require('./input-proxy');

function throwIfNotObservable(thing) {
  if (typeof thing === 'undefined' || typeof thing.subscribe !== 'function') {
    throw new Error('Stream function should always return an Rx.Observable.');
  }
}

function replicate(source, subject) {
  if (typeof source === 'undefined') {
    throw new Error('Cannot replicate() if source is undefined.');
  }
  return source.subscribe(
    function replicationOnNext(x) {
      subject.onNext(x);
    },
    function replicationOnError(err) {
      subject.onError(err);
      console.error(err);
    }
  );
}

function replicateAllInteraction$(input, proxy) {
  let subscriptions = new Rx.CompositeDisposable();
  let selectors = proxy._userEvent$;
  for (let selector in selectors) { if (selectors.hasOwnProperty(selector)) {
    let elemEvents = selectors[selector];
    for (let eventName in elemEvents) { if (elemEvents.hasOwnProperty(eventName)) {
      let event$ = input.choose(selector, eventName);
      if (event$ !== null) {
        let subscription = replicate(event$, elemEvents[eventName]);
        subscriptions.add(subscription);
      }
    }}
  }}
  return subscriptions;
}

function replicateAll(input, proxy) {
  if (!input || !proxy) { return; }

  if (typeof input.choose === 'function') {
    return replicateAllInteraction$(input, proxy);
  } else if (typeof input.subscribe === 'function' && proxy.type === 'InputProxy') {
    return replicate(input, proxy);
  } else {
    throw new Error('Cycle Stream got injected with invalid inputs.');
  }
}

function makeInjectFn(stream) {
  return function inject() {
    if (stream._wasInjected) {
      console.warn('Stream has already been injected an input.');
    }
    if (stream._definitionFn.length !== arguments.length) {
      console.warn('The call to inject() should provide the inputs that this ' +
      'Stream expects according to its definition function.');
    }
    let injectArgs = arguments;
    stream._injectOnSubscribe = function injectOnSubscribe() {
      for (let i = 0; i < stream._definitionFn.length; i++) {
        let subscription = replicateAll(injectArgs[i], stream._proxies[i]);
        stream._subscription.add(subscription);
      }
    };
    if (typeof stream.interaction$ !== 'undefined' ||
      typeof stream.choose === 'function')
    {
      stream._wasSubscribed = true;
    }
    if (stream._wasSubscribed) {
      stream._injectOnSubscribe();
    }
    stream._wasInjected = true;
    if (arguments.length === 1) {
      return arguments[0];
    } else if (arguments.length > 1) {
      return Array.prototype.slice.call(arguments);
    } else {
      return null;
    }
  };
}

function makeDisposeFn(stream) {
  return function dispose() {
    if (stream._subscription && typeof stream._subscription.dispose === 'function') {
      stream._subscription.dispose();
    }
  };
}

function makeSubscribe(stream) {
  let oldSubscribe = stream.subscribe;
  return function subscribe() {
    let disposable = oldSubscribe.apply(stream, arguments);
    if (typeof stream._injectOnSubscribe === 'function') {
      stream._injectOnSubscribe();
    }
    stream._wasSubscribed = true;
    return disposable;
  };
}

function createStream(definitionFn) {
  if (arguments.length !== 1 || typeof definitionFn !== 'function') {
    throw new Error('Stream expects the definitionFn as the only argument.');
  }

  let proxies = [];
  for (let i = 0; i < definitionFn.length; i++) {
    proxies[i] = new InputProxy();
  }
  let stream = definitionFn.apply({}, proxies);
  throwIfNotObservable(stream);
  stream._proxies = proxies;
  stream._definitionFn = definitionFn;
  stream._wasInjected = false;
  stream._wasSubscribed = false;
  stream._subscription = new Rx.CompositeDisposable();
  stream.inject = makeInjectFn(stream);
  stream.dispose = makeDisposeFn(stream);
  stream.subscribe = makeSubscribe(stream);
  return stream;
}

module.exports = {
  createStream
};
