package com.marketdata.model;

/**
 * Represents ticker data for a spot trading pair.
 */
public class TickerData {
    private String symbol;
    private String lastPrice;
    private String change24h;
    private String change24hPercent;
    private String volume24h;
    private String high24h;
    private String low24h;

    public TickerData() {}

    public TickerData(String symbol, String lastPrice, String change24h,
                      String change24hPercent, String volume24h,
                      String high24h, String low24h) {
        this.symbol = symbol;
        this.lastPrice = lastPrice;
        this.change24h = change24h;
        this.change24hPercent = change24hPercent;
        this.volume24h = volume24h;
        this.high24h = high24h;
        this.low24h = low24h;
    }

    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }

    public String getLastPrice() { return lastPrice; }
    public void setLastPrice(String lastPrice) { this.lastPrice = lastPrice; }

    public String getChange24h() { return change24h; }
    public void setChange24h(String change24h) { this.change24h = change24h; }

    public String getChange24hPercent() { return change24hPercent; }
    public void setChange24hPercent(String change24hPercent) { this.change24hPercent = change24hPercent; }

    public String getVolume24h() { return volume24h; }
    public void setVolume24h(String volume24h) { this.volume24h = volume24h; }

    public String getHigh24h() { return high24h; }
    public void setHigh24h(String high24h) { this.high24h = high24h; }

    public String getLow24h() { return low24h; }
    public void setLow24h(String low24h) { this.low24h = low24h; }
}
