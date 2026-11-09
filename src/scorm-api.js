(function () {
  'use strict';

  function findApi(startWindow, name) {
    let current = startWindow;
    let depth = 0;
    while (current && depth < 500) {
      try {
        if (current[name]) return current[name];
        if (current.parent === current) break;
        current = current.parent;
      } catch (_) { break; }
      depth += 1;
    }
    try {
      if (startWindow.opener && startWindow.opener !== startWindow && startWindow.opener[name]) return startWindow.opener[name];
    } catch (_) { /* Cross-origin opener is optional. */ }
    return null;
  }

  function createAdapter() {
    let api = null;
    let version = 'standalone';
    let initialized = false;
    let terminated = false;

    function invoke(name, ...argumentsList) {
      if (!api || typeof api[name] !== 'function') return true;
      try {
        const result = api[name](...argumentsList);
        if (result === 'false' || result === false) return false;
        return true;
      } catch (_) { return false; }
    }

    function readValue(name, key) {
      if (!api || typeof api[name] !== 'function') return { ok: false, value: '' };
      try {
        const result = api[name](key);
        if (result === false || result === 'false' || result == null) return { ok: false, value: '' };
        return { ok: true, value: String(result) };
      } catch (_) { return { ok: false, value: '' }; }
    }

    function commit() {
      if (!api) return true;
      return version === '2004' ? invoke('Commit', '') : invoke('LMSCommit', '');
    }

    return {
      get version() { return version; },
      get isAvailable() { return Boolean(api); },
      initialize() {
        if (initialized) return true;
        api = findApi(window, 'API_1484_11');
        if (api) version = '2004';
        else {
          api = findApi(window, 'API');
          version = api ? '1.2' : 'standalone';
        }
        if (!api) { initialized = true; return true; }
        const ok = version === '2004' ? invoke('Initialize', '') : invoke('LMSInitialize', '');
        initialized = ok;
        if (ok) {
          const key = version === '2004' ? 'cmi.completion_status' : 'cmi.core.lesson_status';
          const statusRead = readValue(version === '2004' ? 'GetValue' : 'LMSGetValue', key);
          const status = statusRead.value.trim().toLowerCase();
          if (!statusRead.ok || !status || status === 'unknown' || status === 'not attempted') {
            if (version === '2004') invoke('SetValue', key, 'incomplete');
            else invoke('LMSSetValue', key, 'incomplete');
            commit();
          }
        }
        return ok;
      },
      getProgress() {
        if (!initialized || terminated || !api) return null;
        const key = version === '2004' ? 'cmi.location' : 'cmi.core.lesson_location';
        const result = readValue(version === '2004' ? 'GetValue' : 'LMSGetValue', key);
        const value = result.value.trim();
        return result.ok && value ? value : null;
      },
      setProgress(value) {
        if (!initialized || terminated || !api) return true;
        const key = version === '2004' ? 'cmi.location' : 'cmi.core.lesson_location';
        const ok = version === '2004' ? invoke('SetValue', key, String(value ?? '')) : invoke('LMSSetValue', key, String(value ?? ''));
        return commit() && ok;
      },
      complete() {
        if (!initialized || terminated || !api) return true;
        const key = version === '2004' ? 'cmi.completion_status' : 'cmi.core.lesson_status';
        const status = version === '2004' ? 'completed' : 'completed';
        const ok = version === '2004' ? invoke('SetValue', key, status) : invoke('LMSSetValue', key, status);
        return commit() && ok;
      },
      terminate() {
        if (terminated) return true;
        terminated = true;
        if (!api || !initialized) return true;
        return version === '2004' ? invoke('Terminate', '') : invoke('LMSFinish', '');
      }
    };
  }

  window.SCORMAdapter = createAdapter();
}());
