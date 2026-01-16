from dataclasses import dataclass
from datetime import date, datetime
import requests 


@dataclass
class NWSForecast:
    temp_high: int
    temp_low: int
    forecast_time: datetime
    short_description: str = "" # cloudy, sunny, etc
    long_description: str = "" # Cloudy with a chance of rain
    hourly_temps: list[tuple[str,int]] = None


def get_observed_temps():
    """
    Get ACTUAL observed temperatures from the Central Park weather station (KNYC).
    This is what Kalshi uses for NYC high temp markets.
    """
    url = "https://api.weather.gov/stations/KNYC/observations"
    headers = {'User-Agent': 'my_nyc_weather_bot'}
    response = requests.get(url, headers=headers)
    data = response.json()
    
    today = date.today().isoformat()
    
    observed = {
        'temps': [],
        'hourly': []
    }
    
    for obs in data.get('features', []):
        timestamp = obs['properties'].get('timestamp', '')
        if today in timestamp:
            temp_c = obs['properties'].get('temperature', {}).get('value')
            if temp_c is not None:
                temp_f = int(round((temp_c * 9/5) + 32))
                time_str = timestamp.split('T')[1][:5]
                observed['temps'].append(temp_f)
                observed['hourly'].append((time_str, temp_f))
    
    return observed


def get_daily_forecast(): 
    """Get forecast data (for when we don't have enough observations yet)"""
    url = f"https://api.weather.gov/gridpoints/OKX/34,38/forecast"
    headers = {'User-Agent': 'my_nyc_weather_bot'}
    response = requests.get(url, headers=headers)
    nyc_forecast = response.json()
    
    today = date.today().isoformat()

    daily_forecast = {}
    
    for eachday in nyc_forecast["properties"]["periods"]:
        if today in eachday["startTime"]:
            if eachday['isDaytime']:
                daily_forecast['highest_temperature'] = eachday["temperature"]
            else:
                daily_forecast['lowest_temperature'] = eachday["temperature"]
    
    return daily_forecast


def get_hourly_forecast():
    """Get hourly forecast (future temps only)"""
    url = f"https://api.weather.gov/gridpoints/OKX/34,38/forecast/hourly"
    headers = {'User-Agent': 'my_nyc_weather_bot'}
    response = requests.get(url, headers=headers)
    nyc_hourly_forecast = response.json()

    today = date.today().isoformat()

    hourly_forecast = []

    for eachhour in nyc_hourly_forecast["properties"]["periods"]:
        if today in eachhour["startTime"]: 
            hourly_forecast.append((eachhour["startTime"].split("T")[1],eachhour["temperature"]))

    return hourly_forecast


def parse_nws_forecast():
    """
    Main function to get NYC temperatures.
    
    Priority:
    1. Use OBSERVED temps from Central Park station (KNYC) - most accurate
    2. Fall back to forecast if observations not available
    """
    # Get observed temps from Central Park
    observed = get_observed_temps()
    
    # Get forecast as backup
    daily_forecast = get_daily_forecast()
    hourly_forecast = get_hourly_forecast()
    
    # Determine high/low from observations if available
    if observed['temps']:
        temp_high = max(observed['temps'])
        temp_low = min(observed['temps'])
        hourly_data = observed['hourly']
        print(f"   📍 Using observed temps from Central Park (KNYC)")
    else:
        # Fall back to forecast
        temp_high = daily_forecast.get('highest_temperature', 0)
        temp_low = daily_forecast.get('lowest_temperature', 0)
        hourly_data = hourly_forecast
        print(f"   ⚠️ Using forecast data (no observations available)")
    
    # If we have forecast data for the afternoon, compare with current high
    # and use the higher of the two (since high might still be coming)
    forecast_high = daily_forecast.get('highest_temperature')
    if forecast_high and forecast_high > temp_high:
        print(f"   📈 Forecast predicts higher temp ({forecast_high}°F) later today")
    
    return NWSForecast(
        temp_high = temp_high,
        temp_low = temp_low,
        forecast_time = datetime.now(),
        hourly_temps = hourly_data
    )

