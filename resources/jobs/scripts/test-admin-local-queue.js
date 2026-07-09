const assert = require("assert");
const queue = require("./admin-local-queue");

function createStorage(options = {}) {
  const store = new Map();
  const maxBytes = Number.isFinite(Number(options.maxBytes)) ? Number(options.maxBytes) : Infinity;
  const alwaysFail = Boolean(options.alwaysFail);
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (alwaysFail) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      if (Buffer.byteLength(String(value), "utf8") > maxBytes) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

function buildLegacyAction(index, ageDays, status) {
  const createdAt = new Date(Date.now() - (ageDays * 24 * 60 * 60 * 1000)).toISOString();
  return {
    id: `legacy-${index}`,
    status: status || "queued",
    operation: "publish_selected",
    created_at: createdAt,
    updated_at: createdAt,
    source: "admin-review",
    payload_json: JSON.stringify({
      operation: "publish_selected",
      actor: "Admin Review Console",
      source: "admin-review",
      timestamp: createdAt,
      ids: [`job-${index}`],
      jobs: [{
        id: `job-${index}`,
        title: `Job ${index}`,
        organization: "Example Org",
        description: "x".repeat(200000),
        raw_description: "y".repeat(200000),
        raw_payload: { html: "z".repeat(100000) }
      }],
      edited_jobs: [{
        id: `job-${index}`,
        editedRecord: {
          display: {
            title: `Edited Job ${index}`,
            description: "d".repeat(50000),
            organization: "Example Org"
          }
        }
      }]
    })
  };
}

function main() {
  const diagnostics = [];
  const storage = createStorage();
  const legacyActions = [];
  for (let i = 0; i < 125; i += 1) {
    legacyActions.push(buildLegacyAction(i, i < 3 ? 10 : 1, i < 2 ? "applied" : "queued"));
  }
  const persisted = queue.persistQueue(storage, queue.QUEUE_KEY, legacyActions, {
    referenceData: {
      committedActions: [{
        id: "snapshot-1",
        operation: "archive_active_job",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        payload: {
          operation: "archive_active_job",
          id: "job-4"
        }
      }],
      records: [{
        id: "job-5",
        updated_at: new Date().toISOString()
      }]
    },
    onDiagnostics(entry) {
      diagnostics.push(entry);
    }
  });

  assert.strictEqual(persisted.ok, true, "persist should succeed");
  assert.ok(persisted.actions.length <= queue.MAX_ACTIONS, "queue count should be capped");
  assert.ok(persisted.diagnostics.serializedBytes <= queue.MAX_BYTES, "serialized queue should fit size cap");
  assert.ok(persisted.diagnostics.prunedCount > 0, "oversized queue should prune items");
  persisted.actions.forEach((action) => {
    const payload = action.payload || {};
    assert.ok(!Array.isArray(payload.jobs), "sanitized queue should not store full jobs");
    assert.ok(!String(action.payload_json || "").includes("raw_description"), "payload_json should exclude raw descriptions");
    const editedDisplay = payload.edited_jobs?.[0]?.editedRecord?.display || payload.editedRecord?.display || {};
    assert.ok(!Object.prototype.hasOwnProperty.call(editedDisplay, "description"), "edited description should be dropped");
  });
  assert.ok(diagnostics.length > 0, "diagnostics callback should run");

  const reloaded = queue.loadQueue(storage, queue.QUEUE_KEY, {});
  assert.strictEqual(reloaded.ok, true, "loadQueue should succeed");
  assert.ok(reloaded.actions.length <= queue.MAX_ACTIONS, "reloaded queue should stay pruned");

  queue.clearQueue(storage, queue.QUEUE_KEY, {});
  const cleared = queue.loadQueue(storage, queue.QUEUE_KEY, {});
  assert.strictEqual(cleared.actions.length, 0, "clear should remove queued actions");

  const failingStorage = createStorage({ alwaysFail: true });
  const failedPersist = queue.persistQueue(failingStorage, queue.QUEUE_KEY, [buildLegacyAction(999, 0, "queued")], {});
  assert.strictEqual(failedPersist.ok, false, "persistent quota failures should surface as failed writes");
  assert.strictEqual(failedPersist.warning, queue.LARGE_WRITE_WARNING, "persistent quota failures should return the admin warning");

  console.log("[test-admin-local-queue] passed", {
    persistedCount: persisted.actions.length,
    persistedBytes: persisted.diagnostics.serializedBytes,
    prunedCount: persisted.diagnostics.prunedCount
  });
}

main();
