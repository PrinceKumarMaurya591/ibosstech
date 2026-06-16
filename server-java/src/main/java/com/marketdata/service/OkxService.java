package com.marketdata.service;

import com.marketdata.model.OrderBookData;
import com.marketdata.model.TickerData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * Service for interacting with the OKX REST API.
 * Fetches market data using public endpoints (no API key required).
 */
@Service
public class OkxService implements DataSource {

    private static final Logger log = LoggerFactory.getLogger(OkxService.class);

    private final RestTemplate restTemplate;
    private final String okxRestBase;
    private final OrderBookService orderBookService;

    public OkxService(@Value("${market.data.okx-rest-base}") String okxRestBase,
                      OrderBookService orderBookService) {
        this.okxRestBase = okxRestBase;
        this.orderBookService = orderBookService;
        this.restTemplate = new RestTemplate();
    }

    @Override
    public String getName() {
        return "okx";
    }

    /**
     * Fetch the top 20 spot trading pairs by 24h volume from OKX.
     * OKX's /api/v5/market/tickers returns all tickers sorted by volume (descending).
     */
    @SuppressWarnings("unchecked")
    @Override
    public List<TickerData> fetchTop20Pairs() {
        String url = okxRestBase + "/api/v5/market/tickers?instType=SPOT";

        try {
            Map<String, Object> response = restTemplate.getForObject(url, Map.class);

            if (response == null || !"0".equals(response.get("code"))) {
                log.error("OKX API error: {}", response);
                throw new RuntimeException("OKX API returned error: " +
                        (response != null ? response.get("msg") : "null response"));
            }

            List<Map<String, Object>> allTickers = (List<Map<String, Object>>) response.get("data");
            if (allTickers == null || allTickers.isEmpty()) {
                log.warn("No tickers returned from OKX");
                return Collections.emptyList();
            }

            return allTickers.stream()
                    .limit(20)
                    .map(this::mapToTickerData)
                    .collect(Collectors.toList());

        } catch (Exception e) {
            log.error("Failed to fetch top 20 pairs from OKX: {}", e.getMessage());
            throw new RuntimeException("Failed to fetch market data: " + e.getMessage(), e);
        }
    }

    /**
     * Fetch ticker for a single symbol.
     */
    @SuppressWarnings("unchecked")
    @Override
    public TickerData fetchTicker(String symbol) {
        String url = okxRestBase + "/api/v5/market/ticker?instId=" + symbol;

        try {
            Map<String, Object> response = restTemplate.getForObject(url, Map.class);

            if (response == null || !"0".equals(response.get("code"))) {
                return null;
            }

            List<Map<String, Object>> data = (List<Map<String, Object>>) response.get("data");
            if (data == null || data.isEmpty()) {
                return null;
            }

            return mapToTickerData(data.get(0));

        } catch (Exception e) {
            log.error("Failed to fetch ticker for {}: {}", symbol, e.getMessage());
            return null;
        }
    }

    /**
     * Subscribe to order book updates. Delegates to OrderBookService.
     */
    @Override
    public Runnable subscribeOrderBook(String symbol, Consumer<OrderBookData> callback) {
        return orderBookService.subscribeOrderBook(symbol, callback);
    }

    /**
     * Map OKX API response fields to TickerData.
     */
    private TickerData mapToTickerData(Map<String, Object> t) {
        String last = safeString(t.get("last"), "0");
        String open24h = safeString(t.get("open24h"), null);

        String change24h;
        String change24hPercent;
        if (open24h != null && !open24h.equals("0")) {
            double lastPrice = Double.parseDouble(last);
            double openPrice = Double.parseDouble(open24h);
            double change = lastPrice - openPrice;
            double changePct = (change / openPrice) * 100.0;

            int decimals = last.contains(".") ? last.split("\\.")[1].length() : 2;
            change24h = String.format("%." + decimals + "f", change);
            change24hPercent = String.format("%.2f", changePct);
        } else {
            change24h = "0";
            change24hPercent = "0";
        }

        return new TickerData(
                safeString(t.get("instId"), ""),
                last,
                change24h,
                change24hPercent,
                safeString(t.getOrDefault("volCcy24h", t.get("vol24h")), "0"),
                safeString(t.get("high24h"), "0"),
                safeString(t.get("low24h"), "0")
        );
    }

    private String safeString(Object value, String defaultValue) {
        return value != null ? value.toString() : defaultValue;
    }
}
