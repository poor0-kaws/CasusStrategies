import sys
from config import load_config
from clients import nws_client, kalshi_client
import gemini

def main():
    """Main entry point for the NYC Weather Trading Advisor"""
    print("═══════════════════════════════════════════")
    print("  NYC TEMPERATURE TRADING ADVISOR (NWS)   ")
    print("═══════════════════════════════════════════\n")

    # 1. Load Configuration
    try:
        config = load_config()
        print("✅ Configuration loaded.")
    except Exception as e:
        print(f"❌ Error loading config: {e}")
        sys.exit(1)

    # 2. Fetch NWS Forecast
    print("☁️  Fetching NWS forecast for New York City...")
    try:
        weather = nws_client.parse_nws_forecast()
        print(f"✅ Found today's high: {weather.temp_high}°F / low: {weather.temp_low}°F")
    except Exception as e:
        print(f"❌ Error fetching weather: {e}")
        sys.exit(1)

    # 3. Fetch Kalshi Market Prices
    print("📈 Fetching Kalshi NYC market prices...")
    try:
        markets = kalshi_client.get_nyc_markets()
        if not markets:
            print("⚠️  No open NYC temperature markets found on Kalshi.")
            sys.exit(0)
        print(f"✅ Found {len(markets)} active contracts.")
    except Exception as e:
        print(f"❌ Error fetching Kalshi data: {e}")
        sys.exit(1)

    # 4. Get Gemini AI Recommendation
    print("🤖 Sending data to Gemini for analysis...")
    recommendation = gemini.get_recommendation(weather, markets, config)

    if not recommendation:
        print("❌ Could not get a recommendation from Gemini.")
        sys.exit(1)

    # 5. Print the Final Report
    print("\n" + "═" * 43)
    print("  💎 FINAL TRADING RECOMMENDATION 💎  ")
    print("═" * 43)
    
    print(f"\n📅 Date: {weather.forecast_time.strftime('%B %d, %Y')}")
    print(f"🌡️  Recommended Range: {recommendation.temperature_range}°F")
    print(f"📈 Action: {recommendation.action}")
    print(f"💯 Confidence: {recommendation.confidence}%")
    
    print(f"\n📊 Market Ticker: {recommendation.market_ticker}")
    print(f"\n💭 Reasoning:")
    # Wrap text for easier reading
    reasoning = recommendation.reasoning
    print(f"   {reasoning}")

    print("\n" + "═" * 43)
    print("      HAPPY TRADING! GOOD LUCK!      ")
    print("═" * 43)

if __name__ == "__main__":
    main()
