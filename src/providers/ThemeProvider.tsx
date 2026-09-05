'use client';

// Dark by default. The choice is stored per browser and applied as a `.light` class on <html>,
// which the palette in globals.css keys off. Reads are wrapped because storage throws outright in
// some embedded contexts.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cookie-pulse-theme';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts at 'dark' on both server and client so hydration matches, then adopts whatever the
  // GateScript already put on <html> pre-paint.
  const [theme, setTheme] = useState<Theme>('dark');
  const applied = useRef(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }, []);

  useEffect(() => {
    // Skipped on the first pass: at that point `theme` is still the placeholder, and writing it
    // would strip the class the GateScript set before first paint — a visible flash for anyone
    // whose stored theme is light.
    if (!applied.current) {
      applied.current = true;
      return;
    }
    document.documentElement.classList.toggle('light', theme === 'light');
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage blocked — the class on <html> is still correct for this session.
    }
  }, [theme]);

  // Time-boxed crossfade. The attribute is what scopes it: a standing transition on `.glass` would
  // tax every hover and every poll-driven class change on a backdrop-filtered surface.
  const changingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (changingTimer.current) clearTimeout(changingTimer.current);
    },
    [],
  );

  const toggle = useCallback(() => {
    const root = document.documentElement;
    root.dataset.themeChanging = '';
    if (changingTimer.current) clearTimeout(changingTimer.current);
    changingTimer.current = setTimeout(() => {
      delete root.dataset.themeChanging;
    }, 280);
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
