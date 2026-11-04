/**
 * Room and boundary utilities for ProxiSpeak spatial zones.
 */

// Manager Cabin boundaries: [x: 705-965, y: 35-255]
export function isInsideManagerCabin(x, y) {
  return x >= 705 && x <= 965 && y >= 35 && y <= 255;
}

