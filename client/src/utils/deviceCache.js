/**
 * ProxiSpeak Client Edge Device Cache
 * 
 * Provides resilient, privacy-preserving, local-first caching for:
 * 1. User avatar coordinates per office (instant restore on refresh/reconnect)
 * 2. Office layouts, obstacles, and zones (zero-latency instant UI render)
 * 3. User device preferences (theme, audio, mute states)
 */

const STORAGE_PREFIX = 'proxispeak:v1:';
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory fallback if localStorage is disabled or throws quota errors
const memoryFallback = new Map();

function safeGet(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(STORAGE_PREFIX + key);
    }
  } catch (err) {
    console.warn('[deviceCache] localStorage read failed, using memory fallback:', err.message);
  }
  return memoryFallback.get(key) || null;
}

function safeSet(key, value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_PREFIX + key, value);
      return;
    }
  } catch (err) {
    console.warn('[deviceCache] localStorage write failed, using memory fallback:', err.message);
  }
  memoryFallback.set(key, value);
}

function safeRemove(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_PREFIX + key);
      return;
    }
  } catch (err) {
    // Ignore removal error
  }
  memoryFallback.delete(key);
}

export const deviceCache = {
  /**
   * Save user's last known avatar position in an office
   */
  savePosition(officeId, userId, coords) {
    if (!officeId || !coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return;
    const key = `pos:${officeId}:${userId || 'anonymous'}`;
    const payload = JSON.stringify({
      x: Math.round(coords.x),
      y: Math.round(coords.y),
      timestamp: Date.now(),
    });
    safeSet(key, payload);
  },

  /**
   * Load user's last known avatar position in an office
   */
  loadPosition(officeId, userId) {
    if (!officeId) return null;
    const key = `pos:${officeId}:${userId || 'anonymous'}`;
    const raw = safeGet(key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        return { x: data.x, y: data.y, timestamp: data.timestamp };
      }
    } catch {
      safeRemove(key);
    }
    return null;
  },

  /**
   * Save office layout (walls, zones, dimensions) for instant hydration
   */
  saveOffice(officeId, officeData) {
    if (!officeId || !officeData) return;
    const key = `office:${officeId}`;
    const payload = JSON.stringify({
      officeId: officeData.officeId || officeId,
      name: officeData.name,
      width: officeData.width,
      height: officeData.height,
      obstacles: officeData.obstacles || [],
      zones: officeData.zones || [],
      hearingRadiusPx: officeData.hearingRadiusPx || 105,
      cachedAt: Date.now(),
    });
    safeSet(key, payload);
  },

  /**
   * Load cached office layout for instant, zero-delay rendering
   */
  loadOffice(officeId) {
    if (!officeId) return null;
    const key = `office:${officeId}`;
    const raw = safeGet(key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data && data.width && data.height) {
        // Expire if older than MAX_CACHE_AGE_MS
        if (data.cachedAt && Date.now() - data.cachedAt > MAX_CACHE_AGE_MS) {
          safeRemove(key);
          return null;
        }
        return data;
      }
    } catch {
      safeRemove(key);
    }
    return null;
  },

  /**
   * Save user audio and UI preferences locally on device
   */
  savePreferences(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    const current = this.loadPreferences() || {};
    safeSet('preferences', JSON.stringify({ ...current, ...prefs, updatedAt: Date.now() }));
  },

  /**
   * Load user audio and UI preferences
   */
  loadPreferences() {
    const raw = safeGet('preferences');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      safeRemove('preferences');
      return null;
    }
  },

  /**
   * Clear user's position cache (e.g. on logout or office switch)
   */
  clearPosition(officeId, userId) {
    safeRemove(`pos:${officeId}:${userId || 'anonymous'}`);
  },
};

export default deviceCache;

