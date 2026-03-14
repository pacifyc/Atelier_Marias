function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action;
  var payload = data.payload;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try {
    if (action === 'sync_product') {
      return syncProduct(ss, payload);
    } else if (action === 'sync_sale') {
      return syncSale(ss, payload);
    } else if (action === 'sync_category') {
      return syncCategory(ss, payload);
    } else if (action === 'delete_product') {
      return deleteRow(ss, 'Produtos', 'CÓDIGO DO PRODUTO', payload);
    } else if (action === 'delete_category') {
      return deleteRow(ss, 'Categorias', 'CATEGORIA', payload);
    } else if (action === 'get_all_data') {
      return getAllData(ss);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function syncProduct(ss, product) {
  var sheet = getOrCreateSheet(ss, 'Produtos');
  var headers = ['CÓDIGO DO PRODUTO', 'DESCRIÇÃO DO PRODUTO', 'VALOR', 'ESTOQUE', 'CATEGORIA', 'LOCAL DA FOTO'];
  ensureHeaders(sheet, headers);
  
  var rowData = [
    product.id,
    product.name,
    product.price,
    product.stock,
    product.category || 'Geral',
    product.image || ''
  ];
  
  upsertRow(sheet, 'CÓDIGO DO PRODUTO', product.id, rowData);
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function syncSale(ss, sale) {
  // 1. Aba Vendas
  var sheetVendas = getOrCreateSheet(ss, 'Vendas');
  var headersVendas = ['CÓDIGO DA VENDA', 'CLIENTE', 'DATA COMPRA', 'FORMA DE PAGAMENTO', 'VALOR DA COMPRA', 'DATA SINCRONISMO'];
  ensureHeaders(sheetVendas, headersVendas);
  
  var rowVenda = [
    sale.id,
    sale.client,
    sale.date,
    sale.paymentType,
    sale.totalValue,
    new Date()
  ];
  upsertRow(sheetVendas, 'CÓDIGO DA VENDA', sale.id, rowVenda);
  
  // 2. Aba Itens_Venda
  var sheetItens = getOrCreateSheet(ss, 'Itens_Venda');
  var headersItens = ['CÓDIGO DA VENDA', 'CÓDIGO DO PRODUTO', 'DESCRIÇÃO DO PRODUTO', 'VALOR UNITÁRIO', 'QUANTIDADE', 'VALOR TOTAL'];
  ensureHeaders(sheetItens, headersItens);
  
  // Limpar itens anteriores desta venda para evitar duplicidade em edição
  deleteRowsByValue(sheetItens, 'CÓDIGO DA VENDA', sale.id);
  
  if (sale.products && sale.products.length > 0) {
    sale.products.forEach(function(p) {
      var rowItem = [
        sale.id,
        p.id, // O app já envia o inventoryId/id correto
        p.name,
        parseFloat(p.price),
        parseInt(p.quantity),
        parseFloat(p.price) * parseInt(p.quantity)
      ];
      sheetItens.appendRow(rowItem);
    });
  }
  
  // 3. Aba Parcelas_Venda
  var sheetParcelas = getOrCreateSheet(ss, 'Parcelas_Venda');
  var headersParcelas = ['CÓDIGO DA VENDA', 'PARCELA', 'DATA', 'VALOR DA PARCELA', 'SITUAÇÃO'];
  ensureHeaders(sheetParcelas, headersParcelas);
  
  deleteRowsByValue(sheetParcelas, 'CÓDIGO DA VENDA', sale.id);
  
  if (sale.installmentList && sale.installmentList.length > 0) {
    sale.installmentList.forEach(function(inst) {
      var rowParcela = [
        sale.id,
        inst.number,
        inst.date,
        inst.value,
        inst.status === 'paid' ? 'Pago' : 'Pendente'
      ];
      sheetParcelas.appendRow(rowParcela);
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function syncCategory(ss, categoryName) {
  var sheet = getOrCreateSheet(ss, 'Categorias');
  var headers = ['CATEGORIA'];
  ensureHeaders(sheet, headers);
  
  upsertRow(sheet, 'CATEGORIA', categoryName, [categoryName]);
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

// --- Funções Utilitárias ---

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
  }
}

function upsertRow(sheet, keyHeader, keyValue, rowData) {
  var data = sheet.getDataRange().getValues();
  var headerRow = data[0];
  var keyColIndex = headerRow.indexOf(keyHeader);
  
  if (keyColIndex === -1) return sheet.appendRow(rowData);
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][keyColIndex].toString() === keyValue.toString()) {
      sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      return;
    }
  }
  sheet.appendRow(rowData);
}

function deleteRow(ss, sheetName, keyHeader, keyValue) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  
  var data = sheet.getDataRange().getValues();
  var headerRow = data[0];
  var keyColIndex = headerRow.indexOf(keyHeader);
  
  if (keyColIndex === -1) return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][keyColIndex].toString() === keyValue.toString()) {
      sheet.deleteRow(i + 1);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function deleteRowsByValue(sheet, keyHeader, keyValue) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  
  var headerRow = data[0];
  var keyColIndex = headerRow.indexOf(keyHeader);
  if (keyColIndex === -1) return;
  
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][keyColIndex].toString() === keyValue.toString()) {
      sheet.deleteRow(i + 1);
    }
  }
}

function formatDateString(val, ss) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, ss.getSpreadsheetTimeZone() || "GMT", "yyyy-MM-dd");
  }
  var str = val.toString();
  if (str.indexOf('T') > -1) str = str.split('T')[0];
  return str;
}

function getAllData(ss) {
  var result = {
    success: true,
    categories: [],
    products: [],
    sales: [],
    sale_items: [],
    installments: []
  };

  // Categorias
  var sheetCat = ss.getSheetByName('Categorias');
  if (sheetCat) {
    var dataCat = sheetCat.getDataRange().getValues();
    if (dataCat.length > 1) {
      for (var i = 1; i < dataCat.length; i++) {
        if (dataCat[i][0]) result.categories.push(dataCat[i][0].toString());
      }
    }
  }

  // Produtos
  var sheetProd = ss.getSheetByName('Produtos');
  if (sheetProd) {
    var dataProd = sheetProd.getDataRange().getValues();
    if (dataProd.length > 1) {
      var headers = dataProd[0];
      var idxId = headers.indexOf('CÓDIGO DO PRODUTO');
      var idxName = headers.indexOf('DESCRIÇÃO DO PRODUTO');
      var idxPrice = headers.indexOf('VALOR');
      var idxStock = headers.indexOf('ESTOQUE');
      var idxCategory = headers.indexOf('CATEGORIA');
      var idxImage = headers.indexOf('LOCAL DA FOTO');

      for (var i = 1; i < dataProd.length; i++) {
        var row = dataProd[i];
        if (idxId !== -1 && row[idxId]) {
          result.products.push({
            id: row[idxId].toString(),
            name: (idxName !== -1 && row[idxName]) ? row[idxName].toString() : '',
            price: (idxPrice !== -1 && row[idxPrice]) ? row[idxPrice].toString() : '0',
            stock: (idxStock !== -1 && row[idxStock]) ? parseInt(row[idxStock]) || 0 : 0,
            category: (idxCategory !== -1 && row[idxCategory]) ? row[idxCategory].toString() : 'Geral',
            image: (idxImage !== -1 && row[idxImage]) ? row[idxImage].toString() : null,
            history: [] // Histórico não é persistido no Google Sheets atualmente
          });
        }
      }
    }
  }

  // Vendas
  var sheetVendas = ss.getSheetByName('Vendas');
  if (sheetVendas) {
    var dataVendas = sheetVendas.getDataRange().getValues();
    if (dataVendas.length > 1) {
      var headers = dataVendas[0];
      var idxId = headers.indexOf('CÓDIGO DA VENDA');
      var idxClient = headers.indexOf('CLIENTE');
      var idxDate = headers.indexOf('DATA COMPRA');
      var idxPayment = headers.indexOf('FORMA DE PAGAMENTO');
      var idxTotal = headers.indexOf('VALOR DA COMPRA');

      for (var i = 1; i < dataVendas.length; i++) {
        var row = dataVendas[i];
        if (idxId !== -1 && row[idxId]) {
          result.sales.push({
            id: row[idxId].toString(),
            client: (idxClient !== -1 && row[idxClient]) ? row[idxClient].toString() : '',
            date: (idxDate !== -1) ? formatDateString(row[idxDate], ss) : '',
            paymentType: (idxPayment !== -1 && row[idxPayment]) ? row[idxPayment].toString() : 'vista',
            installments: '1', // Será ajustado no app baseado nas parcelas
            totalValue: (idxTotal !== -1 && row[idxTotal]) ? parseFloat(row[idxTotal]) || 0 : 0
          });
        }
      }
    }
  }

  // Itens Venda
  var sheetItens = ss.getSheetByName('Itens_Venda');
  if (sheetItens) {
    var dataItens = sheetItens.getDataRange().getValues();
    if (dataItens.length > 1) {
      var headers = dataItens[0];
      var idxSaleId = headers.indexOf('CÓDIGO DA VENDA');
      var idxProdId = headers.indexOf('CÓDIGO DO PRODUTO');
      var idxName = headers.indexOf('DESCRIÇÃO DO PRODUTO');
      var idxPrice = headers.indexOf('VALOR UNITÁRIO');
      var idxQty = headers.indexOf('QUANTIDADE');

      for (var i = 1; i < dataItens.length; i++) {
        var row = dataItens[i];
        if (idxSaleId !== -1 && row[idxSaleId]) {
          result.sale_items.push({
            sale_id: row[idxSaleId].toString(),
            id: (idxProdId !== -1 && row[idxProdId]) ? row[idxProdId].toString() : '',
            name: (idxName !== -1 && row[idxName]) ? row[idxName].toString() : '',
            price: (idxPrice !== -1 && row[idxPrice]) ? row[idxPrice].toString() : '0',
            quantity: (idxQty !== -1 && row[idxQty]) ? row[idxQty].toString() : '1',
            inventoryId: (idxProdId !== -1 && row[idxProdId]) ? row[idxProdId].toString() : null
          });
        }
      }
    }
  }

  // Parcelas Venda
  var sheetParcelas = ss.getSheetByName('Parcelas_Venda');
  if (sheetParcelas) {
    var dataParcelas = sheetParcelas.getDataRange().getValues();
    if (dataParcelas.length > 1) {
      var headers = dataParcelas[0];
      var idxSaleId = headers.indexOf('CÓDIGO DA VENDA');
      var idxNum = headers.indexOf('PARCELA');
      var idxDate = headers.indexOf('DATA');
      var idxValue = headers.indexOf('VALOR DA PARCELA');
      var idxStatus = headers.indexOf('SITUAÇÃO');

      for (var i = 1; i < dataParcelas.length; i++) {
        var row = dataParcelas[i];
        if (idxSaleId !== -1 && row[idxSaleId]) {
          result.installments.push({
            sale_id: row[idxSaleId].toString(),
            number: (idxNum !== -1 && row[idxNum]) ? parseInt(row[idxNum]) || 1 : 1,
            date: (idxDate !== -1) ? formatDateString(row[idxDate], ss) : '',
            value: (idxValue !== -1 && row[idxValue]) ? parseFloat(row[idxValue]) || 0 : 0,
            status: (idxStatus !== -1 && row[idxStatus] && row[idxStatus].toString() === 'Pago') ? 'paid' : 'pending'
          });
        }
      }
    }
  }

  // Ajustar número de parcelas na venda
  if (result.sales && result.installments) {
      for (var i = 0; i < result.sales.length; i++) {
          var saleId = result.sales[i].id;
          var count = result.installments.filter(function(inst) { return inst.sale_id === saleId; }).length;
          result.sales[i].installments = count > 0 ? count.toString() : '1';
      }
  }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
