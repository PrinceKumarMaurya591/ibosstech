package com.marketdata.model;

import java.util.List;

/**
 * Represents a snapshot of order book data (bids and asks).
 */
public class OrderBookData {
    private List<OrderBookLevel> bids;
    private List<OrderBookLevel> asks;
    private String timestamp;

    public OrderBookData() {}

    public OrderBookData(List<OrderBookLevel> bids, List<OrderBookLevel> asks, String timestamp) {
        this.bids = bids;
        this.asks = asks;
        this.timestamp = timestamp;
    }

    public List<OrderBookLevel> getBids() { return bids; }
    public void setBids(List<OrderBookLevel> bids) { this.bids = bids; }

    public List<OrderBookLevel> getAsks() { return asks; }
    public void setAsks(List<OrderBookLevel> asks) { this.asks = asks; }

    public String getTimestamp() { return timestamp; }
    public void setTimestamp(String timestamp) { this.timestamp = timestamp; }
}
