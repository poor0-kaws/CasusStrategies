import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

# New York coordinates for weather APIs
NYC_LAT = 40.785091
NYC_LON = -73.968285

# API Base URLs
KALSHI_BASE_URL_PROD = "https://trading-api.kalshi.com/trade-api/v2"
KALSHI_BASE_URL_DEMO = "https://demo-api.kalshi.co/trade-api/v2"
NWS_BASE_URL = "https://api.weather.gov"


@dataclass
class Config:
    """Container for all API credentials and settings"""
    # Kalshi - uses RSA key authentication
    kalshi_key_id: str              # Your Key ID from Kalshi
    kalshi_private_key: str         # The actual RSA private key content
    kalshi_env: str                 # "sandbox" or "production"
    kalshi_base_url: str            # Determined by kalshi_env
    
    # AI
    gemini_api_key: str


def load_config() -> Config:
    """
    Reads the .env file and loads the RSA private key.
    
    Returns:
        Config: An object with all our credentials
    """
    
    # Step 1: Load environment variables from .env file
    env_path = Path(__file__).parent / ".env"
    load_dotenv(dotenv_path=env_path, override=True)
    
    # Step 2: Get each value from environment
    kalshi_key_id = os.getenv("KALSHI_API_KEY_ID", "").strip()
    kalshi_env = os.getenv("KALSHI_ENV", "sandbox").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    
    # Step 3: Load the RSA private key from file
    key_file_path = os.getenv("KALSHI_KEY_FILE", "kalshi_private_key.pem")
    
    # Get the directory where this config.py file is located
    project_dir = Path(__file__).parent
    full_key_path = project_dir / key_file_path
    
    if not full_key_path.exists():
        raise FileNotFoundError(
            f"Kalshi private key file not found: {full_key_path}\n"
            "Make sure 'kalshi_private_key.pem' exists in your project folder."
        )
    
    # Read the private key content
    kalshi_private_key = full_key_path.read_text()
    
    # Step 4: Check for missing required values
    missing = []
    if not kalshi_key_id:
        missing.append("KALSHI_API_KEY_ID")
    if not gemini_key:
        missing.append("GEMINI_API_KEY")
    
    if missing:
        raise ValueError(
            f"Missing required environment variables in .env file: {missing}\n"
            "Please add them to your .env file."
        )
    
    # Step 5: Determine which Kalshi URL to use
    if kalshi_env == "production":
        kalshi_base_url = KALSHI_BASE_URL_PROD
    else:
        kalshi_base_url = KALSHI_BASE_URL_DEMO
    
    # Step 6: Create and return the Config object
    return Config(
        kalshi_key_id=kalshi_key_id,
        kalshi_private_key=kalshi_private_key,
        kalshi_env=kalshi_env,
        kalshi_base_url=kalshi_base_url,
        gemini_api_key=gemini_key
    )
