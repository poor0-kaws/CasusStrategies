import requests
from dataclasses import dataclass
from typing import List
from datetime import date
import re

@dataclass
class Market:
    """Dataclass for a single Kalshi market contract"""
    ticker: str
    title: str
    min_temp: int
    max_temp: int
    yes_price: float
    no_price: float

def get_today_date_string() -> str:
    """
    Returns today's date in Kalshi ticker format (e.g., '26JAN16' for Jan 16, 2026)
    """
    today = date.today()
    return today.strftime("%y%b%d").upper()  # e.g., "26JAN16"

def get_nyc_markets() -> List[Market]:
    """
    Fetches open NYC temperature markets from Kalshi's public API.
    Filters to only return TODAY's markets.
    """
    url = "https://api.elections.kalshi.com/trade-api/v2/markets"
    today_str = get_today_date_string()
    
    # Try both ticker series
    for ticker_series in ["KXHIGHNY", "HIGHNYC"]:
        params = {
            "series_ticker": ticker_series,
            "status": "open",
            "limit": 50  # Get more to ensure we have today's
        }
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            markets = []
            for market_data in data.get("markets", []):
                ticker = market_data.get("ticker", "")
                # Only include TODAY's markets
                if today_str in ticker:
                    m = _parse_market(market_data)
                    if m:
                        markets.append(m)
            
            if markets:
                print(f"   📅 Filtered for today's event: {ticker_series}-{today_str}")
                return markets
        except Exception as e:
            print(f"Error fetching {ticker_series}: {e}")
            
    return []

def _parse_market(m_data: dict) -> Market:
    """Parses a single market from the API response"""
    ticker = m_data.get("ticker", "")
    title = m_data.get("title", "")
    
    # Prices are in cents (0-100), convert to float (0-1.0)
    yes_price = m_data.get("yes_bid", 0) / 100.0
    no_price = m_data.get("no_ask", 100) / 100.0
    
    # Extract temp from ticker 
    # Format examples: KXHIGHNY-26JAN16-T40 (threshold 40), KXHIGHNY-26JAN16-B39.5 (bracket 39.5)
    min_t, max_t = 0, 0
    try:
        temp_part = ticker.split("-")[-1]  # e.g., "T40" or "B39.5"
        
        if temp_part.startswith("T"):
            # Threshold contract: "above X degrees"
            threshold = float(temp_part[1:])
            min_t = int(threshold)
            max_t = min_t + 1
        elif temp_part.startswith("B"):
            # Bracket contract: "between X and Y degrees"
            bracket_temp = float(temp_part[1:])
            min_t = int(bracket_temp)
            max_t = min_t + 1
            
    except (ValueError, IndexError):
        # Fallback: try to get from title if ticker parsing fails
        try:
            numbers = re.findall(r'(\d+(?:\.\d+)?)', title)
            temp_numbers = [float(n) for n in numbers if 0 <= float(n) <= 150]
            if len(temp_numbers) >= 2:
                min_t = int(temp_numbers[-2])
                max_t = int(temp_numbers[-1])
        except:
            pass
        
    return Market(
        ticker=ticker,
        title=title,
        min_temp=min_t,
        max_temp=max_t,
        yes_price=yes_price,
        no_price=no_price
    )
