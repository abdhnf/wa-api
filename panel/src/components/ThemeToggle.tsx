import React from 'react';
import { Sun, Moon, Laptop } from 'lucide-react';
import { useTheme } from '../lib/theme';

/**
 * ThemeToggle 3-state rotasi via 1-klik langsung:
 *   system -> light -> dark -> system
 * Default awal: 'system'.
 */
export const ThemeToggle: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const handleCycle = () => {
    if (theme === 'system') {
      setTheme('light');
    } else if (theme === 'light') {
      setTheme('dark');
    } else {
      setTheme('system');
    }
  };

  const nextModeLabel =
    theme === 'system' ? 'Light' : theme === 'light' ? 'Dark' : 'System';

  return (
    <button
      type="button"
      onClick={handleCycle}
      className="wa-control wa-control-secondary wa-tap h-9 px-2.5 gap-1.5 cursor-pointer text-xs select-none"
      title={`Tema saat ini: ${theme} (${resolvedTheme}). Klik untuk beralih ke mode ${nextModeLabel}.`}
      aria-label={`Mode tema: ${theme}. Klik untuk beralih ke ${nextModeLabel}`}
    >
      {theme === 'system' ? (
        <Laptop className="w-4 h-4 text-sea transition-transform" />
      ) : theme === 'dark' ? (
        <Moon className="w-4 h-4 text-pine-soft transition-transform hover:-rotate-12 duration-200" />
      ) : (
        <Sun className="w-4 h-4 text-honey transition-transform hover:rotate-45 duration-200" />
      )}
      <span className="capitalize text-[11px] font-mono hidden sm:inline">
        {theme}
      </span>
    </button>
  );
};
