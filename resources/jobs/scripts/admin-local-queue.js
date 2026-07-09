(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.AdminLocalQueue = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var QUEUE_KEY = "jobs_local_admin_action_queue_v1";
  var MAX_ACTIONS = 100;
  var MAX_BYTES = 2 * 1024 * 1024;
  var STALE_MS = 7 * 24 * 60 * 60 * 1000;
  var LARGE_WRITE_WARNING = "Local admin queue is full. Please sync or clear local queued actions.";
  var PATCH_FIELDS = new Set([
    "title",
    "organization",
    "location",
    "location_type",
    "pay_display",
    "salary_min",
    "salary_max",
    "role_type",
    "experience_level",
    "sector",
    "function",
    "specialization",
    "specialization_confidence",
    "tags",
    "source_name",
    "source_url",
    "original_url",
    "application_url",
    "page_url_override",
    "featured",
    "published",
    "public_visibility",
    "status",
    "display_order",
    "admin_notes"
  ]);
  var STATUS_DROP_PRIORITY = new Set([
    "applied",
    "already_published",
    "blocked",
    "ignored_duplicate",
    "ignored_invalid_empty_publish_selected",
    "mirrored",
    "partially_applied",
    "resolved",
    "skipped_newer_decision",
    "skipped_stale"
  ]);
  var REPLAY_SENSITIVE_OPERATIONS = new Set([
    "publish_selected",
    "archive_selected",
    "archive_active_job",
    "unpublish_active_job",
    "feature_selected",
    "feature_active_job"
  ]);

  function safeJsonParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function byteLength(value) {
    var text = String(value || "");
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).length;
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.byteLength(text, "utf8");
    }
    return text.length;
  }

  function asString(value) {
    return String(value == null ? "" : value).trim();
  }

  function uniqueStrings(values) {
    var seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map(asString)
      .filter(Boolean)
      .filter(function (value) {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function stableTimestamp(value, fallback) {
    var text = asString(value);
    var parsed = Date.parse(text);
    if (Number.isFinite(parsed) && parsed > 0) return new Date(parsed).toISOString();
    return fallback || new Date().toISOString();
  }

  function getActionTimestamp(action) {
    var updatedAt = Date.parse(asString(action && action.updated_at));
    if (Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt;
    var createdAt = Date.parse(asString(action && action.created_at));
    if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;
    var payloadTimestamp = Date.parse(asString(action && action.payload && action.payload.timestamp));
    if (Number.isFinite(payloadTimestamp) && payloadTimestamp > 0) return payloadTimestamp;
    return 0;
  }

  function targetIdsFromPayload(payload) {
    if (!payload || typeof payload !== "object") return [];
    var ids = []
      .concat(Array.isArray(payload.ids) ? payload.ids : [])
      .concat(Array.isArray(payload.selected_ids) ? payload.selected_ids : [])
      .concat(Array.isArray(payload.selectedIds) ? payload.selectedIds : [])
      .concat(Array.isArray(payload.job_ids) ? payload.job_ids : [])
      .concat(Array.isArray(payload.jobIds) ? payload.jobIds : []);
    var singleId = asString(payload.job_id || payload.id || payload.recordId);
    if (singleId) ids.push(singleId);
    return uniqueStrings(ids);
  }

  function pruneEditedRecord(editedRecord) {
    if (!editedRecord || typeof editedRecord !== "object") return null;
    var next = {};
    Object.keys(editedRecord).forEach(function (key) {
      if (key === "display" && editedRecord.display && typeof editedRecord.display === "object" && !Array.isArray(editedRecord.display)) {
        var display = {};
        Object.keys(editedRecord.display).forEach(function (displayKey) {
          if (!PATCH_FIELDS.has(displayKey) || displayKey === "description") return;
          var value = editedRecord.display[displayKey];
          if (Array.isArray(value)) {
            display[displayKey] = value.slice(0, 25).map(asString).filter(Boolean);
            return;
          }
          if (value === null || value === undefined || value === "") return;
          display[displayKey] = value;
        });
        if (Object.keys(display).length) next.display = display;
        return;
      }
      if (!PATCH_FIELDS.has(key)) return;
      if (key === "description") return;
      var value = editedRecord[key];
      if (value === null || value === undefined || value === "") return;
      next[key] = Array.isArray(value) ? value.slice(0, 25).map(asString).filter(Boolean) : value;
    });
    return Object.keys(next).length ? next : null;
  }

  function sanitizePayload(payload, nowIso) {
    var sourcePayload = payload && typeof payload === "object" ? payload : {};
    var ids = targetIdsFromPayload(sourcePayload);
    var editedJobs = Array.isArray(sourcePayload.edited_jobs) ? sourcePayload.edited_jobs : [];
    var sanitizedEditedJobs = editedJobs
      .map(function (item) {
        var id = asString(item && item.id);
        var editedRecord = pruneEditedRecord(item && item.editedRecord);
        if (!id && !editedRecord) return null;
        return {
          id: id,
          editedRecord: editedRecord
        };
      })
      .filter(Boolean);
    var editedRecord = pruneEditedRecord(sourcePayload.editedRecord || sourcePayload.record || null);
    var sanitized = {
      operation: asString(sourcePayload.operation || sourcePayload.action),
      action: asString(sourcePayload.operation || sourcePayload.action),
      actor: asString(sourcePayload.actor || "Admin Review Console"),
      source: asString(sourcePayload.source || "admin-review"),
      timestamp: stableTimestamp(sourcePayload.timestamp, nowIso),
      ids: ids,
      job_ids: ids.slice(),
      id: asString(sourcePayload.id || sourcePayload.recordId || ids[0] || ""),
      job_id: asString(sourcePayload.job_id || sourcePayload.id || sourcePayload.recordId || ids[0] || ""),
      recordId: asString(sourcePayload.recordId || sourcePayload.id || ids[0] || ""),
      organization: asString(sourcePayload.organization || ""),
      featured: typeof sourcePayload.featured === "boolean" ? sourcePayload.featured : undefined,
      public_visibility: typeof sourcePayload.public_visibility === "boolean" ? sourcePayload.public_visibility : undefined,
      published: typeof sourcePayload.published === "boolean" ? sourcePayload.published : undefined,
      status: asString(sourcePayload.status || ""),
      display_order: Number.isFinite(Number(sourcePayload.display_order)) ? Number(sourcePayload.display_order) : undefined,
      changed_fields: uniqueStrings(sourcePayload.changed_fields || sourcePayload.changedFields || []),
      editedRecord: editedRecord,
      edited_jobs: sanitizedEditedJobs
    };
    Object.keys(sanitized).forEach(function (key) {
      if (sanitized[key] === undefined) delete sanitized[key];
      if (Array.isArray(sanitized[key]) && sanitized[key].length === 0) delete sanitized[key];
      if (typeof sanitized[key] === "string" && !sanitized[key]) delete sanitized[key];
    });
    return sanitized;
  }

  function buildQueueEntry(payload, status, nowIso) {
    var sanitizedPayload = sanitizePayload(payload, nowIso);
    var action = sanitizedPayload.operation || "action";
    return {
      id: asString((payload && payload.local_queue_id) || "") || (action + "-" + Math.random().toString(36).slice(2, 10)),
      status: asString(status || "queued") || "queued",
      created_at: stableTimestamp((payload && payload.timestamp) || nowIso, nowIso),
      updated_at: stableTimestamp(nowIso, nowIso),
      actor: asString(sanitizedPayload.actor || "Admin Review Console"),
      operation: action,
      source: asString(sanitizedPayload.source || "admin-review"),
      job_id: asString(sanitizedPayload.job_id || ""),
      target_ids: targetIdsFromPayload(sanitizedPayload),
      payload: sanitizedPayload,
      payload_json: JSON.stringify(sanitizedPayload)
    };
  }

  function normalizeQueueEntry(item, nowIso) {
    if (!item || typeof item !== "object") return null;
    var payload = item.payload && typeof item.payload === "object"
      ? item.payload
      : safeJsonParse(item.payload_json, {});
    if (!payload || typeof payload !== "object") payload = {};
    if (!payload.operation && item.operation) payload.operation = item.operation;
    if (!payload.source && item.source) payload.source = item.source;
    if (!payload.timestamp) payload.timestamp = item.updated_at || item.created_at || nowIso;
    if (!payload.id && item.job_id) payload.id = item.job_id;
    var entry = buildQueueEntry(payload, item.status || "queued", nowIso);
    entry.id = asString(item.id || entry.id);
    entry.created_at = stableTimestamp(item.created_at || entry.created_at, nowIso);
    entry.updated_at = stableTimestamp(item.updated_at || entry.updated_at, nowIso);
    entry.actor = asString(item.actor || entry.actor || payload.actor || "Admin Review Console");
    entry.source = asString(item.source || entry.source || payload.source || "admin-review");
    entry.operation = asString(item.operation || entry.operation || payload.operation || "action");
    entry.job_id = asString(item.job_id || entry.job_id || payload.job_id || payload.id || "");
    entry.target_ids = targetIdsFromPayload(payload);
    entry.payload = sanitizePayload(payload, entry.created_at);
    entry.payload_json = JSON.stringify(entry.payload);
    return entry;
  }

  function parseStoredQueue(raw, nowIso) {
    var parsed = safeJsonParse(raw, { actions: [] });
    var items = Array.isArray(parsed && parsed.actions) ? parsed.actions : [];
    return items
      .map(function (item) { return normalizeQueueEntry(item, nowIso); })
      .filter(Boolean);
  }

  function serializeQueue(actions, nowIso) {
    return JSON.stringify({
      generated_at: stableTimestamp(nowIso, nowIso),
      actions: Array.isArray(actions) ? actions : []
    });
  }

  function buildReferenceIndex(referenceData) {
    var data = referenceData || {};
    var latestByJobId = new Map();
    var registeredActions = Array.isArray(data.committedActions) ? data.committedActions : [];
    registeredActions.forEach(function (action) {
      var timestamp = getActionTimestamp(action);
      var targetIds = targetIdsFromPayload(action.payload || safeJsonParse(action.payload_json, {}));
      targetIds.forEach(function (id) {
        if (!id) return;
        var current = latestByJobId.get(id) || 0;
        if (timestamp > current) latestByJobId.set(id, timestamp);
      });
    });
    var records = Array.isArray(data.records) ? data.records : [];
    records.forEach(function (record) {
      var id = asString(record && record.id);
      if (!id) return;
      var timestamp = Math.max(
        Date.parse(asString(record.updated_at)) || 0,
        Date.parse(asString(record.last_manual_edit_at)) || 0,
        Date.parse(asString(record.created_at)) || 0
      );
      var current = latestByJobId.get(id) || 0;
      if (timestamp > current) latestByJobId.set(id, timestamp);
    });
    return {
      latestByJobId: latestByJobId
    };
  }

  function isReplaySensitiveOperation(operation) {
    return REPLAY_SENSITIVE_OPERATIONS.has(asString(operation));
  }

  function actionDropReason(action, referenceIndex, nowTs) {
    var actionTimestamp = getActionTimestamp(action);
    var status = asString(action && action.status).toLowerCase();
    if (actionTimestamp && actionTimestamp < (nowTs - STALE_MS)) {
      return "stale";
    }
    if (STATUS_DROP_PRIORITY.has(status)) {
      return "completed";
    }
    if (referenceIndex && isReplaySensitiveOperation(action && action.operation)) {
      var targetIds = Array.isArray(action.target_ids) ? action.target_ids : targetIdsFromPayload(action.payload || {});
      var newer = targetIds.some(function (id) {
        var latest = referenceIndex.latestByJobId.get(asString(id)) || 0;
        return latest > actionTimestamp;
      });
      if (newer) return "newer_server_timestamp";
    }
    return "";
  }

  function measureQueue(actions, nowIso) {
    var serialized = serializeQueue(actions, nowIso);
    return {
      count: Array.isArray(actions) ? actions.length : 0,
      bytes: byteLength(serialized),
      serialized: serialized
    };
  }

  function pruneQueue(actions, options) {
    var nowIso = stableTimestamp(options && options.now, new Date().toISOString());
    var nowTs = Date.parse(nowIso) || Date.now();
    var referenceIndex = buildReferenceIndex(options && options.referenceData);
    var normalized = (Array.isArray(actions) ? actions : [])
      .map(function (item) { return normalizeQueueEntry(item, nowIso); })
      .filter(Boolean);
    var dropped = [];
    var retained = [];

    normalized.forEach(function (action) {
      var reason = actionDropReason(action, referenceIndex, nowTs);
      if (reason) {
        dropped.push({ id: action.id, reason: reason, operation: action.operation });
        return;
      }
      retained.push(action);
    });

    retained.sort(function (a, b) {
      return getActionTimestamp(a) - getActionTimestamp(b);
    });

    while (retained.length > MAX_ACTIONS) {
      var removedByCount = retained.shift();
      dropped.push({ id: removedByCount.id, reason: "max_actions", operation: removedByCount.operation });
    }

    var measurement = measureQueue(retained, nowIso);
    while (measurement.bytes > MAX_BYTES && retained.length) {
      var removableIndex = retained.findIndex(function (action) {
        return STATUS_DROP_PRIORITY.has(asString(action.status).toLowerCase());
      });
      if (removableIndex < 0) removableIndex = 0;
      var removed = retained.splice(removableIndex, 1)[0];
      dropped.push({ id: removed.id, reason: "max_bytes", operation: removed.operation });
      measurement = measureQueue(retained, nowIso);
    }

    return {
      actions: retained,
      diagnostics: {
        queueCount: measurement.count,
        serializedBytes: measurement.bytes,
        prunedCount: dropped.length,
        pruned: dropped
      }
    };
  }

  function persistQueue(storage, key, actions, options) {
    var nowIso = stableTimestamp(options && options.now, new Date().toISOString());
    var pruned = pruneQueue(actions, options);
    var serialized = serializeQueue(pruned.actions, nowIso);
    var diagnostics = {
      queueCount: pruned.diagnostics.queueCount,
      serializedBytes: pruned.diagnostics.serializedBytes,
      prunedCount: pruned.diagnostics.prunedCount,
      lastWrite: "pending",
      pruned: pruned.diagnostics.pruned
    };

    function finalize(ok, failureReason) {
      diagnostics.lastWrite = ok ? "success" : "failure";
      if (typeof (options && options.onDiagnostics) === "function") {
        options.onDiagnostics({
          queueCount: diagnostics.queueCount,
          serializedBytes: diagnostics.serializedBytes,
          prunedCount: diagnostics.prunedCount,
          lastWrite: diagnostics.lastWrite,
          failureReason: failureReason || ""
        });
      }
    }

    try {
      storage.setItem(key || QUEUE_KEY, serialized);
      finalize(true, "");
      return {
        ok: true,
        actions: pruned.actions,
        diagnostics: diagnostics,
        warning: pruned.diagnostics.prunedCount ? "" : ""
      };
    } catch (error) {
      var compactActions = pruned.actions.slice();
      while (compactActions.length > 0 && measureQueue(compactActions, nowIso).bytes > Math.min(MAX_BYTES, 512 * 1024)) {
        compactActions.shift();
      }
      try {
        storage.setItem(key || QUEUE_KEY, serializeQueue(compactActions, nowIso));
        var compactDiagnostics = measureQueue(compactActions, nowIso);
        diagnostics.queueCount = compactDiagnostics.count;
        diagnostics.serializedBytes = compactDiagnostics.bytes;
        diagnostics.prunedCount = pruned.diagnostics.prunedCount + (pruned.actions.length - compactActions.length);
        finalize(true, "");
        return {
          ok: true,
          actions: compactActions,
          diagnostics: diagnostics,
          warning: LARGE_WRITE_WARNING
        };
      } catch (retryError) {
        finalize(false, retryError && retryError.message ? retryError.message : (error && error.message ? error.message : "quota_write_failed"));
        return {
          ok: false,
          actions: compactActions,
          diagnostics: diagnostics,
          warning: LARGE_WRITE_WARNING,
          error: retryError || error
        };
      }
    }
  }

  function loadQueue(storage, key, options) {
    var nowIso = stableTimestamp(options && options.now, new Date().toISOString());
    var raw = "";
    try {
      raw = storage.getItem(key || QUEUE_KEY) || "";
    } catch (_error) {
      raw = "";
    }
    var parsedActions = parseStoredQueue(raw, nowIso);
    var persisted = persistQueue(storage, key || QUEUE_KEY, parsedActions, options);
    if (persisted.ok) return persisted;
    return {
      ok: true,
      actions: parsedActions,
      diagnostics: {
        queueCount: parsedActions.length,
        serializedBytes: measureQueue(parsedActions, nowIso).bytes,
        prunedCount: 0,
        lastWrite: "failure"
      },
      warning: persisted.warning
    };
  }

  function clearQueue(storage, key, options) {
    try {
      storage.removeItem(key || QUEUE_KEY);
    } catch (_error) {
      storage.setItem(key || QUEUE_KEY, serializeQueue([], new Date().toISOString()));
      storage.removeItem(key || QUEUE_KEY);
    }
    if (typeof (options && options.onDiagnostics) === "function") {
      options.onDiagnostics({
        queueCount: 0,
        serializedBytes: 0,
        prunedCount: 0,
        lastWrite: "success"
      });
    }
  }

  return {
    QUEUE_KEY: QUEUE_KEY,
    MAX_ACTIONS: MAX_ACTIONS,
    MAX_BYTES: MAX_BYTES,
    STALE_MS: STALE_MS,
    LARGE_WRITE_WARNING: LARGE_WRITE_WARNING,
    buildQueueEntry: buildQueueEntry,
    buildReferenceIndex: buildReferenceIndex,
    clearQueue: clearQueue,
    loadQueue: loadQueue,
    measureQueue: measureQueue,
    normalizeQueueEntry: normalizeQueueEntry,
    persistQueue: persistQueue,
    pruneEditedRecord: pruneEditedRecord,
    pruneQueue: pruneQueue,
    sanitizePayload: sanitizePayload,
    targetIdsFromPayload: targetIdsFromPayload
  };
}));
