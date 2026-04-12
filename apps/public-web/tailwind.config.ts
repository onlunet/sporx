import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neon Arena Palette
        void: "#050508",
        abyss: "#0a0a12",
        depth: "#11111a",
        surface: "#181825",
        elevated: "#222235",
        mist: "#2a2a40",
        
        // Neon Accents
        "neon-cyan": "#00f5ff",
        "neon-purple": "#b829dd",
        "neon-amber": "#ff9500",
        "neon-green": "#00ff88",
        "neon-red": "#ff3366",
        
        // Semantic colors
        primary: "#00f5ff",
        secondary: "#b829dd",
        success: "#00ff88",
        warning: "#ff9500",
        danger: "#ff3366",
      },
      fontFamily: {
        display: ["Orbitron", "sans-serif"],
        body: ["Rajdhani", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "gradient-primary": "linear-gradient(135deg, #00f5ff 0%, #b829dd 100%)",
        "gradient-heat": "linear-gradient(135deg, #ff9500 0%, #ff3366 100%)",
        "gradient-cool": "linear-gradient(135deg, #00ff88 0%, #00f5ff 100%)",
        "gradient-dark": "linear-gradient(180deg, #181825 0%, #11111a 100%)",
      },
      boxShadow: {
        "glow-cyan": "0 0 20px rgba(0, 245, 255, 0.4), 0 0 40px rgba(0, 245, 255, 0.2)",
        "glow-purple": "0 0 20px rgba(184, 41, 221, 0.4), 0 0 40px rgba(184, 41, 221, 0.2)",
        "glow-amber": "0 0 20px rgba(255, 149, 0, 0.4), 0 0 40px rgba(255, 149, 0, 0.2)",
        "glow-green": "0 0 20px rgba(0, 255, 136, 0.4), 0 0 40px rgba(0, 255, 136, 0.2)",
        "glow-red": "0 0 20px rgba(255, 51, 102, 0.4), 0 0 40px rgba(255, 51, 102, 0.2)",
        "card": "0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "card-hover": "0 12px 48px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 245, 255, 0.1)",
      },
      animation: {
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        "shimmer": "shimmer 3s infinite",
        "float": "float 6s ease-in-out infinite",
        "slide-up": "slideUp 0.5s ease-out",
        "fade-in": "fadeIn 0.3s ease-out",
        "scale-in": "scaleIn 0.3s ease-out",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 5px #00f5ff, 0 0 10px #00f5ff" },
          "50%": { boxShadow: "0 0 20px #00f5ff, 0 0 30px #00f5ff" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [
    function({ addComponents }: { addComponents: Function }) {
      addComponents({
        ".glass-card": {
          background: "linear-gradient(135deg, rgba(24, 24, 37, 0.8) 0%, rgba(17, 17, 26, 0.9) 100%)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        },
        ".neon-border": {
          position: "relative",
          "&::before": {
            content: '""',
            position: "absolute",
            inset: "-1px",
            borderRadius: "inherit",
            padding: "1px",
            background: "linear-gradient(135deg, #00f5ff 0%, #b829dd 100%)",
            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            opacity: "0",
            transition: "opacity 0.3s ease",
          },
          "&:hover::before": {
            opacity: "1",
          },
        },
        ".text-glow": {
          textShadow: "0 0 10px rgba(0, 245, 255, 0.5), 0 0 20px rgba(0, 245, 255, 0.3)",
        },
        ".gradient-text": {
          background: "linear-gradient(135deg, #00f5ff 0%, #b829dd 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        },
      });
    },
  ],
};

export default config;
