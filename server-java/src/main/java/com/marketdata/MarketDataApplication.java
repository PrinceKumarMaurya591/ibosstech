package com.marketdata;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Market Data Service - Spring Boot Application.
 * Fetches live data from OKX and streams it to browser-based clients
 * via REST API and WebSocket.
 */
@SpringBootApplication
@EnableScheduling
public class MarketDataApplication {

    public static void main(String[] args) {
        SpringApplication.run(MarketDataApplication.class, args);
        System.out.println("[Server] Market Data Service started on http://localhost:3001");
        System.out.println("[Server] WebSocket server available on ws://localhost:3001/ws/market");
    }
}
