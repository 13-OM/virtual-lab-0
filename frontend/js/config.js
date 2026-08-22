// App-wide configuration (non-secret values only).
export const CONFIG = {
  APP_NAME: 'Virtual Laboratory',
  // External educational website (Theory & Parse Tree Simulator) — keep exact URL.
  THEORY_URL: 'https://13-om.github.io/Parse-Lab-/',
  THEORY_LABEL: 'Explore Theory & Parse Tree Simulator',
  LANGUAGES: ['LEX (flex)', 'YACC (bison)', 'C', 'C++', 'Python', 'Java', '8085 Assembly', '8086 Assembly', '8051 Assembly', 'Plain text'],
};


export function getTheoryUrl() {
  const returnUrl = window.location.href;
  const theoryBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'https://13-om.github.io/Parse-Lab-/'
    : CONFIG.THEORY_URL;
  return theoryBase + '?return=' + encodeURIComponent(returnUrl);
}
