import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSeedData } from '../data/seed.js';

const STORAGE_KEY = 'shiftcraft.v2';
const AppContext = createContext(null);

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return getSeedData();
}

export function AppProvider({ children }) {
  const [data, setData] = useState(loadData);
  const [isAdmin, setIsAdmin] = useState(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('shiftcraft.theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [data]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('shiftcraft.theme', theme);
  }, [theme]);

  const updateClinic = useCallback((clinicId, changes) => {
    setData(prev => ({
      ...prev,
      clinics: prev.clinics.map(c => c.id === clinicId ? { ...c, ...changes } : c),
    }));
  }, []);

  const assignSlot = useCallback((clinicId, slotType, personId) => {
    setData(prev => ({
      ...prev,
      clinics: prev.clinics.map(c => {
        if (c.id !== clinicId) return c;
        return { ...c, slots: { ...c.slots, [slotType]: personId } };
      }),
    }));
  }, []);

  const updatePerson = useCallback((personId, changes) => {
    setData(prev => ({
      ...prev,
      people: prev.people.map(p => p.id === personId ? { ...p, ...changes } : p),
    }));
  }, []);

  const addPerson = useCallback((person) => {
    setData(prev => ({ ...prev, people: [...prev.people, person] }));
  }, []);

  const deletePerson = useCallback((personId) => {
    setData(prev => ({
      ...prev,
      people: prev.people.filter(p => p.id !== personId),
      clinics: prev.clinics.map(c => ({
        ...c,
        slots: Object.fromEntries(
          Object.entries(c.slots).map(([k, v]) => [k, v === personId ? null : v])
        ),
      })),
    }));
  }, []);

  const addClinic = useCallback((clinic) => {
    setData(prev => ({ ...prev, clinics: [...prev.clinics, clinic] }));
  }, []);

  const addLocation = useCallback((loc) => {
    setData(prev => ({ ...prev, locations: [...prev.locations, loc] }));
  }, []);

  const removeLocation = useCallback((loc) => {
    setData(prev => ({ ...prev, locations: prev.locations.filter(l => l !== loc) }));
  }, []);

  return (
    <AppContext.Provider value={{
      data,
      isAdmin, setIsAdmin,
      theme, setTheme,
      updateClinic, assignSlot,
      updatePerson, addPerson, deletePerson,
      addClinic, addLocation, removeLocation,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
