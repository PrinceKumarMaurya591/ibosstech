package com.marketdata.controller;

import com.marketdata.model.ApiResponse;
import com.marketdata.model.TickerData;
import com.marketdata.service.DataSource;
import com.marketdata.service.SessionManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * REST controller for market data endpoints.
 * Acts as a proxy/aggregator between clients and OKX.
 */
@RestController
@RequestMapping("/api/market")
public class MarketController {

    private static final Logger log = LoggerFactory.getLogger(MarketController.class);

    private final DataSource dataSource;
    private final SessionManager sessionManager;

    // Thread-safe cached market data
    private final List<TickerData> cachedTop20 = new CopyOnWriteArrayList<>();
    private volatile long lastMarketFetch = 0;
    private final AtomicInteger consecutiveFailures = new AtomicInteger(0);

    private static final long REFRESH_INTERVAL_MS = 10_000; // 10 seconds

    public MarketController(DataSource dataSource, SessionManager sessionManager) {
        this.dataSource = dataSource;
        this.sessionManager = sessionManager;
        // Warm the cache on startup
        refreshTop20Pairs();
    }

    /**
     * Periodically refresh market data every 10 seconds.
     */
    @Scheduled(fixedRate = REFRESH_INTERVAL_MS)
    public void scheduledRefresh() {
        refreshTop20Pairs();
    }

    /**
     * Fetch and cache top 20 pairs from OKX.
     * Implements exponential backoff-like logging for failures.
     */
    private synchronized void refreshTop20Pairs() {
        try {
            List<TickerData> freshData = dataSource.fetchTop20Pairs();
            cachedTop20.clear();
            cachedTop20.addAll(freshData);
            lastMarketFetch = System.currentTimeMillis();

            int failures = consecutiveFailures.getAndSet(0);
            if (failures > 0) {
                log.info("[Market] Back online - fetched {} top pairs (after {} failures)",
                        freshData.size(), failures);
            } else {
                log.info("[Market] Fetched {} top pairs", freshData.size());
            }
        } catch (Exception e) {
            int failures = consecutiveFailures.incrementAndGet();
            if (failures <= 3 || failures % 10 == 0) {
                log.error("[Market] Failed to fetch top pairs (attempt {}): {}",
                        failures, e.getMessage());
            }
        }
    }

    /**
     * GET /api/market/top20?sessionId=xxx
     * Get the top 20 spot pairs.
     */
    @GetMapping("/top20")
    public ResponseEntity<ApiResponse<List<TickerData>>> getTop20(
            @RequestParam String sessionId) {
        if (sessionId == null || sessionManager.validateSession(sessionId) == null) {
            return ResponseEntity.status(401)
                    .body(new ApiResponse<>(false, "Invalid or expired session"));
        }

        return ResponseEntity.ok(new ApiResponse<>(true, cachedTop20));
    }

    /**
     * GET /api/market/ticker?sessionId=xxx&symbol=BTC-USDT
     * Get ticker for a specific symbol.
     */
    @GetMapping("/ticker")
    public ResponseEntity<ApiResponse<TickerData>> getTicker(
            @RequestParam String sessionId,
            @RequestParam String symbol) {
        if (sessionId == null || sessionManager.validateSession(sessionId) == null) {
            return ResponseEntity.status(401)
                    .body(new ApiResponse<>(false, "Invalid or expired session"));
        }

        if (symbol == null || symbol.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(new ApiResponse<>(false, "Symbol is required"));
        }

        try {
            TickerData data = dataSource.fetchTicker(symbol.toUpperCase());
            if (data == null) {
                return ResponseEntity.ok(new ApiResponse<>(false, "Symbol not found"));
            }
            return ResponseEntity.ok(new ApiResponse<>(true, data));
        } catch (Exception e) {
            return ResponseEntity.status(500)
                    .body(new ApiResponse<>(false, e.getMessage()));
        }
    }
}
