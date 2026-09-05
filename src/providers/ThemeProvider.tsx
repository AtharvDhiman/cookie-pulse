'use client';

// Dark by default. The choice is stored per browser and applied as a `.light` class on <html>,
// which the palette in globals.css keys off. Reads are wrapped because storage throws outright in
// some embedded contexts.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cookie-pulse-theme';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = readStored();
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage blocked — the class on <html> is still correct for this session.
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
