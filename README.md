# AE Profiling

AE Profiling is a comprehensive web application designed to automatically extract, process, and visualize Adverse Events (AEs) from FDA drug label documents (SPLs) using advanced Large Language Models (LLMs) and standard medical ontologies.

## Features

- **Automated Adverse Event Extraction:** Processes FDA Structured Product Labels (SPL) to intelligently identify, extract, and format adverse events from complex medical texts using Google's state-of-the-art Gemini 3.1-Flash-Lite model.
- **MedDRA Taxonomy Mapping:** Automatically maps extracted clinical verbatim terms to the Medical Dictionary for Regulatory Activities (MedDRA) hierarchy. Supports intelligent fuzzy mapping (exact, synonym, spelling, substring) to standard Preferred Terms (PTs) and System Organ Classes (SOCs).
- **Interactive Web Interface:** A stunning, modern Next.js frontend to visualize the adverse event profiles of drugs. Allows grouping by severity or MedDRA Organ System classes, rendering multiple mentions of the same concept intelligently.
- **Contextual Inspection:** Features tracing capabilities allowing users to inspect the exact label phrasing, reported frequencies, severity classifications, and clinical verbatim context from where the terms were originally extracted.

## Architecture & Technology Stack

The application uses a modern, containerized architecture:

### Frontend
- **Framework:** [Next.js](https://nextjs.org/) (App Router)
- **UI Library:** React
- **Styling:** Custom CSS with a sleek, dark-mode, glassmorphism design.
- **Icons:** Lucide-React

### Backend
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/) (Python)
- **Database:** PostgreSQL (with `pgvector` or standard text capabilities) for storing SPL documents and the structured MedDRA dictionary.
- **LLM Integration:** Google GenAI SDK powered by Gemini 3.1 models for robust and fast natural language processing.
- **Data Ingestion:** Asynchronous parsing of complex XML structured product labels.

### Deployment & Infrastructure
- Docker & Docker Compose setup to run the backend, frontend, and PostgreSQL database seamlessly.

## Getting Started

### Prerequisites

- Node.js (v18+)
- Python (3.10+)
- PostgreSQL (Local or via Docker)
- Docker & Docker Compose (Optional, but recommended)
- A Google Gemini API Key

### Installation

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/seldas/AE_Profiling.git
   cd AE_Profiling
   ```

2. **Environment Variables:**
   Create a `.env` file in the root directory based on `.env.example` (or set the following):
   ```ini
   GEMINI_API_KEY=your_gemini_api_key
   DATABASE_URL=postgresql://user:password@localhost:5432/ae_profile_db
   ```

3. **Running the Database and Backend:**
   If you have Docker Compose installed, you can spin up the environment:
   ```bash
   docker-compose up -d
   ```
   Alternatively, you can run the FastAPI backend locally:
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```

4. **Running the Frontend:**
   In a new terminal window:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000`.

## MedDRA Dictionary Import

The MedDRA standardized dictionary is essential to grouping AEs accurately. Ensure you place the raw MedDRA ASCII files in the expected data directory (`data/MedDRA_28_0_ENglish/MedAscii/`) prior to starting the ingestion jobs so that the system can seed the Postgres database properly on startup.

## Usage

1. Open the frontend dashboard.
2. Select an ingested drug label or upload a new one.
3. Click to trigger the AI Extraction process. The application will stream extraction results in real-time.
4. Switch between the **Severity** and **Organ System (MedDRA)** views to analyze the adverse events mapped to standardized taxonomies.

## License

This project is licensed under the MIT License.
