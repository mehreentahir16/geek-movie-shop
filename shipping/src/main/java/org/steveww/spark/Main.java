package org.steveww.spark;

import com.newrelic.api.agent.NewRelic;
import com.mchange.v2.c3p0.ComboPooledDataSource;
import org.apache.commons.dbutils.QueryRunner;
import org.apache.commons.dbutils.handlers.MapListHandler;
import org.apache.commons.dbutils.DbUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import spark.Spark;
import com.google.gson.Gson;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.apache.http.HttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.DefaultHttpClient;
import org.apache.http.params.BasicHttpParams;
import org.apache.http.params.HttpConnectionParams;
import org.apache.http.params.HttpParams;

public class Main {
    private static String CART_URL = null;
    private static String JDBC_URL = null;
    private static Logger logger = LoggerFactory.getLogger(Main.class);
    private static ComboPooledDataSource cpds = null;

    public static void main(String[] args) {
        // Get ENV configuration values
        CART_URL = String.format("http://%s:8080/shipping/", System.getenv("CART_HOST") != null ? System.getenv("CART_HOST") : "cart");
        JDBC_URL = String.format("jdbc:mysql://%s/cities?useSSL=false&autoReconnect=true&allowPublicKeyRetrieval=true", System.getenv("MYSQL_HOST") != null ? System.getenv("MYSQL_HOST") : "mysql");

        // Create database connector with enhanced settings
        try {
            cpds = new ComboPooledDataSource();
            cpds.setDriverClass("com.mysql.cj.jdbc.Driver"); // Use the latest MySQL driver class
            cpds.setJdbcUrl(JDBC_URL);
            cpds.setUser("shipping");
            cpds.setPassword("secret");
            cpds.setMinPoolSize(10);
            cpds.setAcquireIncrement(5);
            cpds.setMaxPoolSize(50);
            cpds.setMaxIdleTime(300);
            cpds.setUnreturnedConnectionTimeout(300);
            cpds.setTestConnectionOnCheckin(true);
            cpds.setIdleConnectionTestPeriod(60);
            cpds.setAcquireRetryAttempts(5);
            cpds.setAcquireRetryDelay(1000);
            cpds.setBreakAfterAcquireFailure(true);
        } catch (Exception e) {
            logger.error("Database Exception", e);
        }

        // Spark setup
        Spark.port(8080);
        Spark.get("/health", (req, res) -> "OK");
        Spark.get("/count", (req, res) -> handleCount(req, res));
        Spark.get("/codes", (req, res) -> handleCodes(req, res));
        Spark.get("/cities/:code", (req, res) -> handleCities(req, res));
        Spark.get("/match/:code/:text", (req, res) -> handleMatch(req, res));
        Spark.get("/calc/:uuid", (req, res) -> handleCalc(req, res));
        Spark.post("/confirm/:id", (req, res) -> handleConfirm(req, res));

        logger.info("Ready");
    }

    private static String handleCount(spark.Request req, spark.Response res) {
        String data;
        try {
            data = queryToJson("select count(*) as count from cities");
            res.header("Content-Type", "application/json");
        } catch (Exception e) {
            logger.error("count", e);
            res.status(500);
            data = "ERROR";
        }
        return data;
    }

    private static String handleCodes(spark.Request req, spark.Response res) {
        String data;
        try {
            String query = "select code, name from codes order by name asc";
            data = queryToJson(query);
            res.header("Content-Type", "application/json");
        } catch (Exception e) {
            logger.error("codes", e);
            res.status(500);
            data = "ERROR";
        }
        return data;
    }

    private static String handleCities(spark.Request req, spark.Response res) {
        String data;
        try {
            NewRelic.addCustomParameter("country", req.params(":code"));
            String query = "select uuid, name from cities where country_code = ?";
            logger.info("Query " + query);
            data = queryToJson(query, req.params(":code"));
            res.header("Content-Type", "application/json");
        } catch (Exception e) {
            logger.error("cities", e);
            res.status(500);
            data = "ERROR";
        }
        return data;
    }

    private static String handleMatch(spark.Request req, spark.Response res) {
        String data;
        try {
            String query = "select uuid, name from cities where country_code = ? and city like ? order by name asc limit 10";
            logger.info("Query " + query);
            data = queryToJson(query, req.params(":code"), req.params(":text") + "%");
            res.header("Content-Type", "application/json");
        } catch (Exception e) {
            logger.error("match", e);
            res.status(500);
            data = "ERROR";
        }
        return data;
    }

    private static String handleCalc(spark.Request req, spark.Response res) {
        double homeLat = 51.164896;
        double homeLong = 7.068792;
        String data;

        Location location = getLocation(req.params(":uuid"));
        Ship ship = new Ship();
        if (location != null) {
            long distance = location.getDistance(homeLat, homeLong);
            double cost = Math.rint(distance * 5) / 100.0;
            ship.setDistance(distance);
            ship.setCost(cost);
            res.header("Content-Type", "application/json");
            data = new Gson().toJson(ship);
        } else {
            data = "no location";
            logger.warn(data);
            res.status(400);
        }
        return data;
    }

    private static String handleConfirm(spark.Request req, spark.Response res) {
        logger.info("confirm " + req.params(":id") + " - " + req.body());
        String cart = addToCart(req.params(":id"), req.body());
        logger.info("new cart " + cart);

        if (cart.equals("")) {
            res.status(404);
        } else {
            res.header("Content-Type", "application/json");
        }
        return cart;
    }

    private static String queryToJson(String query, Object... args) throws SQLException {
        List<Map<String, Object>> listOfMaps;
        try (Connection conn = cpds.getConnection()) {
            QueryRunner queryRunner = new QueryRunner();
            listOfMaps = queryRunner.query(conn, query, new MapListHandler(), args);
        }
        return new Gson().toJson(listOfMaps);
    }

    private static Location getLocation(String uuid) {
        Location location = null;
        String query = "select latitude, longitude from cities where uuid = ?";

        try (Connection conn = cpds.getConnection();
             PreparedStatement stmt = conn.prepareStatement(query)) {
            stmt.setString(1, uuid);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    location = new Location(rs.getDouble(1), rs.getDouble(2));
                }
            }
        } catch (Exception e) {
            logger.error("Location exception", e);
        }
        return location;
    }

    private static String addToCart(String id, String data) {
        StringBuilder buffer = new StringBuilder();

        DefaultHttpClient httpClient = null;
        try {
            HttpParams httpParams = new BasicHttpParams();
            HttpConnectionParams.setConnectionTimeout(httpParams, 5000);

            httpClient = new DefaultHttpClient(httpParams);
            HttpPost postRequest = new HttpPost(CART_URL + id);
            StringEntity payload = new StringEntity(data);
            payload.setContentType("application/json");
            postRequest.setEntity(payload);
            HttpResponse res = httpClient.execute(postRequest);

            if (res.getStatusLine().getStatusCode() == 200) {
                try (BufferedReader in = new BufferedReader(new InputStreamReader(res.getEntity().getContent()))) {
                    String line;
                    while ((line = in.readLine()) != null) {
                        buffer.append(line);
                    }
                }
            } else {
                logger.warn("Failed with code: " + res.getStatusLine().getStatusCode());
            }
        } catch (Exception e) {
            logger.error("http client exception", e);
        } finally {
            if (httpClient != null) {
                httpClient.getConnectionManager().shutdown();
            }
        }
        return buffer.toString();
    }
}
