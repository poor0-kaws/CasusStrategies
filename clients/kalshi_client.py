import requests
from dataclasses import dataclass
from typing import List
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

def get_nyc_markets() -> List[Market]:
    """
    Fetches open NYC temperature markets from Kalshi's public API.
    Does not require authentication.
    """
    url = "https://api.elections.kalshi.com/trade-api/v2/markets"
    
    # Try both ticker series
    for ticker_series in ["KXHIGHNY", "HIGHNYC"]:
        params = {
            "series_ticker": ticker_series,
            "status": "open",
            "limit": 10
        }
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            markets = []
            for market_data in data.get("markets", []):
                m = _parse_market(market_data)
                if m:
                    markets.append(m)
            
            if markets:
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
    
    # Extract temp range
    min_t, max_t = 0, 0
    try:
        # 1. Try from ticker (e.g., T42)
        temp_part = ticker.split("-")[-1]
        if temp_part.startswith("T"):
            min_t = int(float(temp_part[1:]))
            max_t = min_t + 1
            
        # 2. Refine from title (e.g., "42 to 43")
        numbers = re.findall(r'\d+', title)
        if len(numbers) >= 2:
            min_t = int(numbers[-2])
            max_t = int(numbers[-1])
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
