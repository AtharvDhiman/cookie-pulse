import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'rgb(var(--ground) / <alpha-value>)',
        ground2: 'rgb(var(--ground-2) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface-2) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        ink2: 'rgb(var(--ink-2) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        rule: 'rgb(var(--rule) / <alpha-value>)',
        hairline: 'rgb(var(--hairline) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accent2: 'rgb(var(--accent-2) / <alpha-value>)',
        'accent-fill': 'rgb(var(--accent-fill) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        up: 'rgb(var(--up) / <alpha-value>)',
        down: 'rgb(var(--down) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // `display` points at the MONO stack, not a display face. This is the single largest
        // lever in the terminal redesign: every `font-display` heading in the app — page titles,
        // card titles, the wordmark, stat values — becomes monospaced without touching a
        // component. A terminal sets headings in the same face as its data because they are the
        // same kind of object; a friendly geometric display face is what made this read as a
        // marketing page wearing a dashboard's clothes.
        display: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      // The second lever. Rather than sweep ~80 `rounded-*` classes across 30 files, the SCALE is
      // collapsed: a terminal is drawn with rules and right angles, and a 16px corner radius is
      // the most recognisable tell of the generated-dashboard look. `full` survives untouched
      // because status dots are genuinely circles.
      borderRadius: {
        none: '0',
        sm: '1px',
        DEFAULT: '2px',
        md: '2px',
        lg: '2px',
        xl: '2px',
        '2xl': '3px',
        '3xl': '3px',
        full: '9999px',
      },
      letterSpacing: {
        tightest: '-0.035em',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        // Acknowledging a tap — the only overshoot in the system, and only on small controls.
        'check-pop': {
          from: { opacity: '0', transform: 'scale(.6)' },
          to: { opacity: '1', transform: 'none' },
        },
        // One outward ping when a status genuinely changes. Never on a poll.
        'ping-once': {
          from: { opacity: '0.55', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(2.6)' },
        },
        // The delta wash: a pseudo-element that fades out over a row that is genuinely new.
        'row-arrive': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'fade-in': 'fade-in .2s ease-out',
        'rise-in': 'rise-in .35s cubic-bezier(.2,.7,.3,1) both',
        'pulse-dot': 'pulse-dot 2.4s ease-in-out infinite',
        'check-pop': 'check-pop 220ms cubic-bezier(.34,1.32,.64,1) both',
        'ping-once': 'ping-once 620ms cubic-bezier(.2,.7,.3,1) forwards',
        'row-arrive': 'row-arrive 900ms cubic-bezier(.2,.7,.3,1) forwards',
      },
    },
  },
  plugins: [],
};
export default config;
