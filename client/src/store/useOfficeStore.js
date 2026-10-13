import { create } from 'zustand';

export const useOfficeStore = create((set, get) => ({
  // Authentication & Identity
  userId: typeof window !== 'undefined' ? (sessionStorage.getItem('userId') || localStorage.getItem('userId') || null) : null,
  userName: typeof window !== 'undefined' ? (sessionStorage.getItem('userName') || localStorage.getItem('userName') || 'You') : 'You',
  token: typeof window !== 'undefined' ? (sessionStorage.getItem('token') || localStorage.getItem('token') || null) : null,
  
  // Theme
  isDarkMode: typeof window !== 'undefined' ? (localStorage.getItem('theme') === 'dark') : false,

  // Office & Spatial State
  officeState: {
    officeId: 'main-office',
    name: 'The Commons',
    width: 1000,
    height: 700,
    obstacles: [],
    zones: [],
    users: [],
  },

  // Peer & Spatial Audio states
  peers: {},
  nearbyPeers: {},
  speakingPeers: {},
  mutedPeers: {},
  peerAttenuations: {},

  // Local Audio states
  isMuted: false,
  isSpeaking: false,
  localVolume: 0,
  connectionState: 'connected', // 'connected' | 'reconnecting' | 'offline'

  // Actions
  setUser: (userId, userName, token) => set({ userId, userName, token }),
  clearUser: () => set({ userId: null, userName: 'You', token: null, peers: {}, nearbyPeers: {} }),

  setTheme: (isDark) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }
    set({ isDarkMode: isDark });
  },

  toggleTheme: () => {
    const next = !get().isDarkMode;
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    }
    set({ isDarkMode: next });
  },

  setOfficeState: (officeState) => set({ officeState }),
  updateOfficeState: (partial) => set((state) => ({
    officeState: state.officeState ? { ...state.officeState, ...partial } : partial
  })),

  setPeers: (peers) => set({ peers }),
  updatePeerPosition: (id, pos) => set((state) => ({
    peers: { ...state.peers, [id]: pos }
  })),

  setNearbyPeers: (nearbyPeers) => set({ nearbyPeers }),
  setSpeakingPeers: (speakingPeers) => set({ speakingPeers }),
  setMutedPeers: (mutedPeers) => set({ mutedPeers }),
  setPeerAttenuations: (peerAttenuations) => set({ peerAttenuations }),

  setIsMuted: (isMuted) => set({ isMuted }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  setLocalVolume: (localVolume) => set({ localVolume }),
  setConnectionState: (connectionState) => set({ connectionState }),
}));

