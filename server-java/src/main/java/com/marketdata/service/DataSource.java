package com.marketdata.service;

import com.marketdata.model.TickerData;

import java.util.List;
import java.util.function.Consumer;

/**
 * Abstraction for different exchange data sources (OKX, Binance, etc.).
 * Allows the application to switch between exchanges via configuration.
 */
public interface DataSource {

    /**
     * Fetch the top 20 spot trading pairs by 24h volume.
     */
    List<TickerData> fetchTop20Pairs();

    /**
     * Fetch ticker for a single symbol.
     */
    TickerData fetchTicker(String symbol);

    /**
     * Subscribe to order book updates for a symbol.
     *
     * @param symbol   the trading pair symbol
     * @param callback callback to receive order book data
     * @return a Runnable that unsubscribes when called
     */
    Runnable subscribeOrderBook(String symbol, Consumer<com.marketdata.model.OrderBookData> callback);

    /**
     * Get the name of this data source.
     */
    String getName();
}
