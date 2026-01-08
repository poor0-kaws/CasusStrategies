import json
import google.generativeai as genai
from dataclasses import dataclass
from typing import List, Optional
from config import Config
from clients.nws_client import NWSForecast

@dataclass
class Market:
    """Market dataclass for price and range info"""
    ticker: str
    min_temp: int
    max_temp: int
    yes_price: float
    no_price: float

@dataclass
class GeminiRecommendation:
    """The final decision from the AI"""
    temperature_range: str
    max_temperature: int
    min_temperature: int
    action: str  # "BUY YES" or "BUY NO"
    confidence: int  # 0-100
    reasoning: str
    market_ticker: str

def get_recommendation(
    weather: NWSForecast, 
    markets: List[Market], 
    config: Config
) -> Optional[GeminiRecommendation]:
    """
    Asks Gemini to analyze weather data and market prices to find the best trade.
    """
    
    # 1. Setup the AI
    genai.configure(api_key=config.gemini_api_key)
    model = genai.GenerativeModel('gemini-2.5-flash')
    
    # 2. Create the detailed prompt
    prompt = _build_prompt(weather, markets)
    
    # 3. Call the AI and get a structured response
    try:
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        
        # 4. Parse the JSON result
        data = json.loads(response.text)
        
        return GeminiRecommendation(
            temperature_range=data.get("temperature_range", "Unknown"),
            max_temperature=int(data.get("max_temperature", 0)),
            min_temperature=int(data.get("min_temperature", 0)),
            action=data.get("action", "WAIT"),
            confidence=int(data.get("confidence", 0)),
            reasoning=data.get("reasoning", "No reasoning provided."),
            market_ticker=data.get("market_ticker", "N/A")
        )
        
    except Exception as e:
        print(f"Error calling Gemini: {e}")
        return None

def _build_prompt(weather: NWSForecast, markets: List[Market]) -> str:
    """Creates a detailed instruction for Gemini to think like a trader."""
    
    # Format the weather data
    weather_info = f"""
    OFFICIAL NWS FORECAST FOR NEW YORK CITY:
    - High Temp: {weather.temp_high}F
    - Low Temp: {weather.temp_low}F
    - Current Time: {weather.forecast_time}
    
    HOURLY DATA:
    {weather.hourly_temps[:12]}  # First 12 hours
    """
    
    # Format the market data
    market_listing = "\n".join([
        f"- Ticker: {m.ticker} | Range: {m.min_temp}-{m.max_temp}F | YES: ${m.yes_price} | NO: ${m.no_price}"
        for m in markets
    ])
    
    prompt = f"""
    You are a professional weather event trader for Kalshi. 
    Your goal is to recommend the SINGLE BEST temperature range contract to trade based 
    on the official NWS forecast and current market prices.
    
    {weather_info}
    
    CURRENT KALSHI MARKET PRICES:
    {market_listing}
    
    TASK:
    1. Compare the NWS High Temperature forecast with the available Kalshi ranges.
    2. Identify if any range is "mispriced" (e.g., if NWS says 35F, but the 34-36 range is very cheap).
    3. Choose one specific contract to buy (either YES or NO).
    
    RESPONSE FORMAT (JSON):
    {{
        "temperature_range": "34-36",
        "max_temperature": 36,
        "min_temperature": 34,
        "action": "BUY YES",
        "confidence": 85,
        "reasoning": "Explain your logic briefly...",
        "market_ticker": "HIGHNYC-26JAN08-T34"
    }}
    """
    return prompt