package com.marketdata.model;

/**
 * Represents a single level in the order book (bid or ask).
 */
public class OrderBookLevel {
    private String price;
    private String size;
    private String count;

    public OrderBookLevel() {}

    public OrderBookLevel(String price, String size, String count) {
        this.price = price;
        this.size = size;
        this.count = count;
    }

    public String getPrice() { return price; }
    public void setPrice(String price) { this.price = price; }

    public String getSize() { return size; }
    public void setSize(String size) { this.size = size; }

    public String getCount() { return count; }
    public void setCount(String count) { this.count = count; }
}
