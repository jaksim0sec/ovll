import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  bindRequestAbort
} from "../requestAbort.js";

function pair() {
  const req =
    new EventEmitter();
  const res =
    new EventEmitter();

  req.aborted = false;
  res.writableEnded = false;

  return {
    req,
    res
  };
}

test("request aborted event aborts the upstream signal", () => {
  const { req, res } =
    pair();

  const bound =
    bindRequestAbort(
      req,
      res
    );

  req.aborted = true;
  req.emit("aborted");

  assert.equal(
    bound.signal.aborted,
    true
  );

  bound.cleanup();
});

test("premature response close aborts the upstream signal", () => {
  const { req, res } =
    pair();

  const bound =
    bindRequestAbort(
      req,
      res
    );

  res.emit("close");

  assert.equal(
    bound.signal.aborted,
    true
  );

  bound.cleanup();
});

test("normal completed response close does not become cancellation", () => {
  const { req, res } =
    pair();

  const bound =
    bindRequestAbort(
      req,
      res
    );

  res.writableEnded = true;
  res.emit("close");

  assert.equal(
    bound.signal.aborted,
    false
  );

  bound.cleanup();
});

test("cleanup removes lifecycle listeners and is idempotent", () => {
  const { req, res } =
    pair();

  const bound =
    bindRequestAbort(
      req,
      res
    );

  bound.cleanup();
  bound.cleanup();

  assert.equal(
    req.listenerCount(
      "aborted"
    ),
    0
  );
  assert.equal(
    res.listenerCount(
      "close"
    ),
    0
  );
});
