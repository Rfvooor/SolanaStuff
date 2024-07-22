import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Select, MenuItem, FormControl, InputLabel, Pagination } from '@mui/material';

const App = () => {
  const [data, setData] = useState([]);
  const [interval, setInterval] = useState('1hr');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10); // Number of rows per page
  const [totalPages, setTotalPages] = useState(1); // Total number of pages
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [tokenNumber, setTokenNumber] = useState(0); // Total number of tokens

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch data with pagination
      const response = await axios.get(`http://localhost:3001/tokens/${interval}?page=${page}&pageSize=${rowsPerPage}`);
      if (page === 1) {
        setData(response.data); // Reset data on first page load or interval change
      } else {
        setData((prevData) => [...prevData, ...response.data]);
      }
      // Assuming the response includes total count of items
      const totalItems = parseInt(response.data[0].total)
      setTotalPages(Math.ceil(totalItems / rowsPerPage));
      setTokenNumber(totalItems); // Set total number of tokens
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setLoading(false);
  }, [interval, page, rowsPerPage]);

  useEffect(() => {
    setData([]);
    setPage(1);
    fetchData();
  }, [interval, fetchData]);

  const handlePageChange = (event, value) => {
    setPage(value);
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setData((prevData) => {
      return [...prevData].sort((a, b) => {
        if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
        if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    });
  };

  return (
    <div>
      <h1>{`In the past ${interval} ~${tokenNumber} tokens have hit Raydium from Pump.Fun...how did they perform?`}</h1>
      <FormControl>
        <InputLabel>Interval</InputLabel>
        <Select value={interval} onChange={(e) => setInterval(e.target.value)}>
          <MenuItem value={'1hr'}>1 Hour</MenuItem>
          <MenuItem value={'6hr'}>6 Hours</MenuItem>
          <MenuItem value={'24hr'}>24 Hours</MenuItem>
          <MenuItem value={'7d'}>7 Days</MenuItem>
          <MenuItem value={'30d'}>30 Days</MenuItem>
        </Select>
      </FormControl>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell onClick={() => handleSort('address')}>Address</TableCell>
              <TableCell onClick={() => handleSort('fdv')}>Market Cap</TableCell>
              <TableCell onClick={() => handleSort('currentPrice')}>Current Price</TableCell>
              <TableCell onClick={() => handleSort('ATH')}>ATH</TableCell>
              <TableCell onClick={() => handleSort('ATL')}>ATL</TableCell>
              <TableCell onClick={() => handleSort('maxReturn')}>Max Return</TableCell>
              <TableCell onClick={() => handleSort('maxReturnFromListingPrice')}>Max Return from Listing</TableCell>
              <TableCell onClick={() => handleSort('returnFromListingPrice')}>Return from Listing</TableCell>
              <TableCell onClick={() => handleSort('volume')}>Volume</TableCell>
              <TableCell onClick={() => handleSort('volatility')}>Volatility</TableCell>
              <TableCell onClick={() => handleSort('dexUrl')}>Dexscreener</TableCell>
              <TableCell onClick={() => handleSort('holderCount')}>Holder Count</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((item, index) => (
              <TableRow key={index}>
                <TableCell>{item.address}</TableCell>
                <TableCell>{'$' + item.fdv.toFixed(2)}</TableCell>
                <TableCell>{item.currentPrice}</TableCell>
                <TableCell>{item.ATH}</TableCell>
                <TableCell>{item.ATL}</TableCell>
                <TableCell>{(item.maxReturn * 100).toFixed(2)}%</TableCell>
                <TableCell>{(item.maxReturnFromListingPrice * 100).toFixed(2)}%</TableCell>
                <TableCell>{(item.returnFromListingPrice * 100).toFixed(2)}%</TableCell>
                <TableCell>{item.volume}</TableCell>
                <TableCell>{item.volatility.toFixed(4)}</TableCell>
                <TableCell><a href={item.dexUrl} target="_blank" rel="noopener noreferrer">Link</a></TableCell>
                <TableCell>{item.holderCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Pagination
        count={totalPages}
        page={page}
        onChange={handlePageChange}
        color="primary"
        showFirstButton
        showLastButton
      />
      {loading && <p>Loading...</p>}
    </div>
  );
};

export default App;
