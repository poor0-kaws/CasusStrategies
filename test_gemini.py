import os
import google.generativeai as genai
from dotenv import load_dotenv
from pathlib import Path

# Explicitly load from current directory
env_path = Path('.') / '.env'
load_dotenv(dotenv_path=env_path, override=True)

api_key = os.getenv("GEMINI_API_KEY", "").strip()

try:
    if not api_key:
        print("Error: No API key found!")
    else:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        # Try a model that was in the list
        response = model.generate_content("Say 'Hello'")
        print(f"Success! Response: {response.text}")
except Exception as e:
    print(f"Failed! Error: {e}")
