from dataclasses import dataclass
from datetime import date, datetime
import requests 


@dataclass
class NWSForecast:
    temp_high: int
    temp_low: int
    forecast_time: datetime
    short_description: str = "" # cloudy, sunny, etc
    long_description: str = "" # Cloudy with a chance of rai
    hourly_temps: list[tuple[str,int]] = None


def get_daily_forecast(): 
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
    daily_forecast = get_daily_forecast()
    hourly_forecast = get_hourly_forecast()
    
    if daily_forecast.get('highest_temperature') == None and hourly_forecast:
        daily_forecast['highest_temperature'] = max(hourly_forecast, key=lambda x: x[1])[1]
    
    return NWSForecast(
        temp_high = daily_forecast.get('highest_temperature', 0),
        temp_low = daily_forecast.get('lowest_temperature', 0),
        forecast_time = datetime.now(),
        hourly_temps = hourly_forecast
    )

