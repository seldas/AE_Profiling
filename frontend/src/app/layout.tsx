import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AEProfile - Standardized Adverse Event Label Profiler",
  description: "Locate and process FDA Structured Product Labeling (SPL) drug labels using AI to extract structured, searchable adverse event profiles with verbatim clinical auditing context.",
  keywords: "FDA SPL, Drug Labeling, Adverse Events, Pharmacovigilance, MedDRA, AI Extraction, Localized LLM, DailyMed",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="layout-wrapper">
          <header className="main-header glass-panel">
            <div className="header-container container">
              <a href="/" className="logo-group">
                <span className="logo-icon">🧬</span>
                <span className="logo-text">AE<span className="logo-highlight">Profile</span></span>
              </a>
              <nav className="header-nav">
                <a href="/" className="nav-link">Dashboard</a>
                <a href="https://dailymed.nlm.nih.gov/" target="_blank" rel="noopener noreferrer" className="nav-link external">
                  DailyMed Services ↗
                </a>
              </nav>
            </div>
          </header>
          
          <main className="main-content">
            {children}
          </main>
          
          <footer className="main-footer">
            <div className="footer-container container">
              <p>&copy; {new Date().getFullYear()} AEProfile. Clinical decision support tool powered by local AI. For research purposes only.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
