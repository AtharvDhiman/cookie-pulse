// The whole no-JS contract, in ~150 bytes of blocking script.
//
// Every hidden pre-animation state in globals.css is written as `html.js [data-reveal]…`. This
// script is the only thing that adds `.js`, and it runs during HTML parse. So: no JavaScript, no
// class, nothing is ever hidden — the page is fully readable with scripting off, with a dead
// bundle, or before hydration on a slow connection. That is a structural guarantee rather than a
// runtime check that can lose a race.
//
// It also applies the stored theme before first paint, which removes the light-theme flash the app
// had while ThemeProvider waited for its effect.
export function GateScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html:
          "try{if(localStorage.getItem('cookie-pulse-theme')==='light')document.documentElement.classList.add('light')}catch(e){}document.documentElement.classList.add('js')",
      }}
    />
  );
}
