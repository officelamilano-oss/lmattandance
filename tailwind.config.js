/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        cherry: "var(--cherry)",
        "cherry-dark": "var(--cherry-dark)",
        "cherry-light": "var(--cherry-light)",
        cream: "var(--cream)",
        "cream-light": "var(--cream-light)",
        "cream-dark": "var(--cream-dark)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        present: "var(--present)",
        absent: "var(--absent)",
        half: "var(--half)",
        weekoff: "var(--weekoff)",
        unmarked: "var(--unmarked)",
        late: "var(--late)",
      },
      boxShadow: {
        "glow-present": "0 0 10px var(--glow-present)",
        "glow-absent": "0 0 10px var(--glow-absent)",
        "glow-half": "0 0 10px var(--glow-half)",
        "glow-weekoff": "0 0 10px var(--glow-weekoff)",
        "glow-unmarked": "0 0 10px var(--glow-unmarked)",
      },
      fontFamily: {
        sans: ["var(--font-inter)"],
        display: ["var(--font-anton)"],
      },
    },
  },
};
