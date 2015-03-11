function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return [d.getFullYear(), m < 10 ? ('0' + m) : m, day < 10 ? ('0' + day) : day].join('-');
}

function dayDiff(dlater, dsooner) {
    return Math.round((dlater - dsooner) / (1000 * 60 * 60 * 24));
}

function periodDiff(dlater,dsooner) {
    switch (grouping) {
        case 'daily':
            return dayDiff(dlater, dsooner);
        case 'weekly':
            return Math.ceil((dlater - dsooner) / (7000*60*60*24));
        case 'monthly':
            /*
             1-1-2014 - 3-1-2014 = 12 * 0 + 3 - 1 = 2
             5-1-2013 - 3-1-2014 = 12 * 1 + 3 - 5 = 10
             12-1-2013 - 1-1-2014 = 12 * 1 + 1 - 12 = 1
             */
            return (dlater.getFullYear() - dsooner.getFullYear())*12 + dlater.getMonth() - dsooner.getMonth();
        case 'yearly':
            return dlater.getFullYear() - dsooner.getFullYear();
    }
}

function amtOrDash(rawAmount) {
    if (!rawAmount) {
        return '-';
    }
    if (rawAmount < 0) {
        return '(' + accounting.formatMoney(new BigNumber(rawAmount).dividedBy(100).times(-1)) + ')';
    }
    return accounting.formatMoney(new BigNumber(rawAmount).dividedBy(100));
}
var datePart, dateStart, dateEnd, d3timegroup = d3.time.week, grouping = 'weekly', datePeriod = 'last3m',
    compareStart, compareEnd, compareDatePart = null, compare = null, productSource, cmpPath;

$(document).ready(function () {

    $('#startDate').datepicker({format: 'yyyy-mm-dd'});
    $('#endDate').datepicker({format: 'yyyy-mm-dd'});

    setDatePart();

    $('#productGrid').repeater({
        dataSource: function (o, c) {
            productSource.data(o, c);
        },
        defaultView: 'list',
        list_selectable: false
    });

    $('#employeeGrid').repeater({
        dataSource: function (o, c) {
            employeeSource.data(o, c);
        },
        defaultView: 'list',
        list_selectable: false
    });

    loadChart();

    $('.carousel').each(function () {
        $(this).carousel({
            pause: true,
            interval: false
        });
    });

    $('#detailContainer').on('slid.bs.carousel', function () {
        $('#productGrid').repeater('resize');
        $('#employeeGrid').repeater('resize');
    })

    var selectedIndex = 0;
    $('#detailChoice').on('click', 'li', function () {
        var ix = $(this).index();
        if (selectedIndex != ix) {
            $('#detailContainer').carousel(ix);
            $($('#detailChoice>li')[selectedIndex]).removeClass('active');
            $(this).addClass('active');
            selectedIndex = ix;
        }
    });

    function dateDone(newText) {
        $('#mainChart').fadeOut();
        $('#detailRow').fadeOut();
        $('#loadingMain').fadeIn();
        $('#chartSelection').fadeOut(function () {
            $('#datePeriod').text(newText);
        });
        resetCharts();
    }

    $('#dateRange').on('click', 'li', function () {
        var newDate = $(this).data('value'), newText = $('a',this).text();
        if (newDate != datePeriod) {
            datePeriod = newDate;
            if (newDate == 'custom') {
                $('#startDate').datepicker('update', dateStart);
                $('#endDate').datepicker('update', dateEnd);
                $('#dateModal').modal();
                return;
            }
            setDatePart();
            dateDone(newText);
        }
    });

    $('#dateModal button').on('click', function (e) {
        e.preventDefault();
        dateStart = $('#startDate').datepicker('getDate');
        dateEnd = $('#endDate').datepicker('getDate');
        datePeriod = $('#startDate').val() + '-' + $('#endDate').val();
        dateDone(datePeriod);
        $('#dateModal').modal('hide');
    });

    $('#frequency').on('click', 'li', function () {
        var newGroup = $(this).data('value'), newText = $('a',this).text();
        if (newGroup != grouping) {
            grouping = newGroup;
            setD3Timegroup();
            $('#mainChart').fadeOut();
            $('#detailRow').fadeOut();
            $('#loadingMain').fadeIn();
            $('#chartSelection').fadeOut(function () {
                $('#groupPeriod').text(newText);
            });
            resetCharts();
        }
    });

    $('#compareTo').on('click', 'li', function () {
        var newCompare = $(this).data('value'), newText = $('a',this).text();
        if (newCompare != compare) {
            compare = newCompare;
            setD3Timegroup();
            setDatePart();
            $('#mainChart').fadeOut();
            $('#detailRow').fadeOut();
            $('#loadingMain').fadeIn();
            $('#chartSelection').fadeOut(function () {
                $('#comparePeriod').text(newText);
            });
            // TODO we don't need to reset the charts in this case,
            // but we'll need to refactor to just replace the comparison line
            resetCharts();
        }
    });
    $('#datePeriod').text($('#dateRange li[data-value="'+datePeriod+'"]>a').text());
    $('#groupPeriod').text($('#frequency li[data-value="'+grouping+'"]>a').text());
    if (compare) {
        $('#comparePeriod').text($('#compareTo li[data-value="'+compare+'"]>a').text());
    }
});

function setD3Timegroup() {
    switch (grouping) {
        case 'daily':
            d3timegroup = d3.time.day;
            break;
        case 'weekly':
            d3timegroup = d3.time.week;
            break;
        case 'monthly':
            d3timegroup = d3.time.month;
            break;
    }
}

function resetCharts() {
    loadChart();
    delete employeeSource.sourceData;
    delete productSource.sourceData;
    $('#productGrid').repeater('render');
    $('#employeeGrid').repeater('render');
}

function loadChart() {
    var metric = 'netCollected';
    var margin = { top: 20, right: 20, bottom: 70, left: 90 };
    var width = $('#dailyChart').width() - margin.left - margin.right,
        height = $('#dailyChart').height() - margin.top - margin.bottom;

    var x = d3.time.scale.utc()
            .rangeRound([0, width]),
        y = d3.scale.linear()
            .range([height, 0]);

    if (grouping == 'daily') {
        x.nice(d3.time.day);
    } else if (grouping == 'weekly') {
        x.nice(d3.time.week);
    } else if (grouping == 'monthly') {
        x.nice(d3.time.month);
    }

    var xAxis = d3.svg.axis()
        .scale(x)
        .orient("bottom");

    if (grouping == 'daily') {
        xAxis.tickFormat(d3.time.format('%b %d'));
    } else if (grouping == 'weekly') {
        xAxis.tickFormat(d3.time.format('%b %d'));
        xAxis.ticks(d3.time.week);
    } else if (grouping == 'monthly') {
        xAxis.tickFormat(d3.time.format("%b"));
        xAxis.ticks(d3.time.months);
    }

    var yAxis = d3.svg.axis()
        .scale(y)
        .orient("left")
        .ticks(3)
        .tickFormat(function (d) {
            return accounting.formatMoney(d / 100, {precision: 0});
        });

    $('.chart').empty();
    var chart = d3.select(".chart")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    var displayDate = d3.time.format.utc('%B %d, %Y');

    var tip = d3.tip()
        .attr('class', 'd3-tip')
        .offset([-10, 0])
        .direction(function (d) {
            var xs = x(d.date) / width, ys = y(d[metric]) / height;
            if (xs < .1) {
                return ys < .2 ? 'e' : 'ne';
            } else if (xs > .9) {
                return ys < .2 ? 'sw' : 'nw';
            }
            return ys < .2 ? 's' : 'n';
        })
        .html(function (d) {
            var det = [
                '<table class="table"><thead><tr><th colspan="3">',
                displayDate(d.date), '</th></tr></thead><tbody>',
                '<tr><td>Gross Sales</td><td><span class="badge">', d.noOfSales,
                '</span></td><td>', amtOrDash(d.totalSales), '</td></tr>'];
            if (d.discount) {
                det.push('<tr><td>Discounts</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.discount));
                det.push('</td></tr>');
            }
            if (d.tax) {
                det.push('<tr><td>Taxes</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.tax));
                det.push('</td></tr>');
            }
            if (d.tips) {
                det.push('<tr><td>Tips</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.tips));
                det.push('</td></tr>');
            }
            if (d.noOfRefunds) {
                det.push('<tr><td>Refunds</td><td><span class="badge">');
                det.push(d.noOfRefunds);
                det.push('<td class="amount">');
                det.push(amtOrDash(d.refunds));
                det.push('</td></tr>');
            }
            if (d.fees) {
                det.push('<tr><td>Fees</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.fees));
                det.push('</td></tr>');
            }
            det.push('<tr><th>Net</th><th colspan="2" class="amount">');
            det.push(amtOrDash(d.netCollected));
            det.push('</th></tr></table>');
            return det.join('');
        });
    chart.call(tip);
    var lineTip = d3.tip()
        .attr('class', 'd3-tip')
        .direction(function (d) {
            return 'nw';
        })
        .offset(function () {
            var m = d3.mouse(this),
                p = closestPoint(cmpPath.node(), m);
            console.log(p.y);
            return [Math.max(200,p.y), p.x];
        })
        .html(function (d) {
            var m = d3.mouse(this),
                p = closestPoint(cmpPath.node(), m),
                d = cmpSum[p.ix];
            var det = [
                '<table class="table"><thead><tr><th colspan="3">',
                displayDate(d.oldDate), '</th></tr></thead><tbody>',
                '<tr><td>Gross Sales</td><td><span class="badge">', d.noOfSales,
                '</span></td><td>', amtOrDash(d.totalSales), '</td></tr>'];
            if (d.discount) {
                det.push('<tr><td>Discounts</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.discount));
                det.push('</td></tr>');
            }
            if (d.tax) {
                det.push('<tr><td>Taxes</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.tax));
                det.push('</td></tr>');
            }
            if (d.tips) {
                det.push('<tr><td>Tips</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.tips));
                det.push('</td></tr>');
            }
            if (d.noOfRefunds) {
                det.push('<tr><td>Refunds</td><td><span class="badge">');
                det.push(d.noOfRefunds);
                det.push('<td class="amount">');
                det.push(amtOrDash(d.refunds));
                det.push('</td></tr>');
            }
            if (d.fees) {
                det.push('<tr><td>Fees</td><td colspan="2" class="amount">');
                det.push(amtOrDash(d.fees));
                det.push('</td></tr>');
            }
            det.push('<tr><th>Net</th><th colspan="2" class="amount">');
            det.push(amtOrDash(d.netCollected));
            det.push('</th></tr></table>');
            return det.join('');
        });
    chart.call(lineTip);

    var toDo = 1, mainJson, cmpJson;

    var doneFn = function (json, cmpJson) {

        var formatDate = d3.time.format('%Y-%m-%dT%H:%M:%S%Z');
        var summary = json.data.salesSummary, line;

        chartCsv(summary);

        summary.forEach(function (d) {
            d.date = d.date.replace(/:(\d\d)$/, '$1');
            d.date = formatDate.parse(d.date);
        });

        var days = d3.extent(summary, function (s) {
            return s.date
        });

        // If the specified dates are bigger, use those. Else take the ones from reporting, which can sometimes over-report. Not sure why.
        if (dateStart < days[0]) {
            days[0] = dateStart;
        }
        if (dateEnd > days[1]) {
            days[1] = dateEnd;
        }
        x.domain(days)
            .ticks(d3timegroup);

        yExtent = d3.extent(summary, function (s) {
            return +s[metric] || 0;
        });
        yExtent[0] = Math.min(yExtent[0],0);
        yExtent[1] = Math.max(100, yExtent[1]);
        if (cmpJson) {
            cmpSum = cmpJson.data.salesSummary;
            cmpExtents = d3.extent(cmpSum, function (s) {
                return +s[metric] || 0;
            });
            yExtent[0] = Math.min(yExtent[0],cmpExtents[0]||0);
            yExtent[1] = Math.max(yExtent[1],cmpExtents[1]||0);
        }
        y.domain(yExtent);

        var barWidth = Math.min(100, width / (1+periodDiff(days[1], days[0])));
        chart.append("g")
            .attr("class", "x axis")
            .attr("transform", "translate(" + (barWidth/2) + ',' + height + ")")
            .call(xAxis);

        chart.append("g")
            .attr("class", "y axis")
            .call(yAxis);

        chart.append("g")
            .attr("class", "y axis")
            .append("line")
            .attr("x2", width + 10)/* I'm really not sure why we need the +10 */
            .attr("y1", y(0))
            .attr("y2", y(0));

        chart.append("text")
            .attr("transform", "rotate(-90)")
            .attr("y", 0 - margin.left / 1.5)
            .attr("x", 0 - (height / 2))
            .attr("dy", "1em")
            .style("text-anchor", "middle")
            .text("Net Collected");

        var bar = chart.selectAll(".bar")
            .data(summary)
            .enter().append("rect")
            .attr("class", function (d) {
                return d[metric] < 0 ? "negbar" : "bar";
            })
            .attr("x", function (d) {
                return x(d.date);
            })
            .attr("y", function (d) {
                if (d[metric] >= 0) {
                    return y(d[metric]);
                } else {
                    return y(0);
                }
            })
            .attr("height", function (d) {
                return Math.abs(y(d[metric]) - y(0));
            })
            .attr("width", barWidth)
            .on('mouseover', tip.show)
            .on('mouseout', tip.hide);

        if (cmpJson) {
            line = d3.svg.line()
                .defined(function(d) {
                    return d[metric] != null;
                })
                .x(function (d) {
                    return x(d.date)+(barWidth/2);
                })
                .y(function (d) {
                    return y(d[metric]);
                });
            var momentStart = moment(dateStart);
            var shift = momentStart.diff(compareStart, 'seconds');
            cmpSum.forEach(function (d) {
                d.date = d.date.replace(/:(\d\d)$/, '$1');
                d.oldDate = formatDate.parse(d.date);
                var plus = moment(formatDate.parse(d.date));
                do {
                    // Account for multiple previous periods. Our date should be in their range.
                    plus.add('s', shift);
                } while (plus.diff(momentStart,'seconds') > shift);
                d.date = plus.toDate();
            });
            cmpPath = chart.append("path")
                .datum(cmpSum)
                .attr("class", "line")
                .attr("stroke-dasharray", "5,5")
                .attr("d", line);
            cmpPath = chart.append("path")
                .datum(cmpSum)
                .attr("class", "tipLine")
                .attr("d", line)
                .on('mouseover', lineTip.show)
                .on('mouseout', lineTip.hide);
        }

        $('#t_grossSales>td>span.badge').text(d3.sum(summary, function (d) {
            return d.noOfSales;
        }));
        $('#t_grossSales>td.amount').text(amtOrDash(d3.sum(summary, function (d) {
            return d.sales;
        })));
        $('#t_discounts>td.amount').text(amtOrDash(d3.sum(summary, function (d) {
            return d.discounts;
        })));
        $('#t_taxes>td.amount').text(amtOrDash(d3.sum(summary, function (d) {
            return d.tax;
        })));
        $('#t_tips>td.amount').text(amtOrDash(d3.sum(summary, function (d) {
            return d.tips;
        })));
        $('#t_refunds>td>span.badge').text(d3.sum(summary, function (d) {
            return d.noOfRefunds;
        }));
        $('#t_refunds>td.amount').text(amtOrDash(d3.sum(summary, function (d) {
            return d.refunds;
        })));
        $('#t_fees>td.amount').text(amtOrDash(d3.sum(summary, function (d) {
            return d.fees;
        })));
        $('#t_net>.amount').text(amtOrDash(d3.sum(summary, function (d) {
            return d.netCollected;
        })));

        var byPt = $('#paymentTypeBody');
        byPt.empty();
        paymentTypeRow(byPt, json, 'CHIP', 'Card (Chip)');
        paymentTypeRow(byPt, json, 'SWIPE', 'Card (Swiped)');
        paymentTypeRow(byPt, json, 'KEY', 'Card (Keyed In)');
        paymentTypeRow(byPt, json, 'PAYPAL', 'PayPal');
        paymentTypeRow(byPt, json, 'CASH', 'Cash');
        paymentTypeRow(byPt, json, 'CHECK', 'Check');

        $('#loadingMain').fadeOut();
        $('#mainChart').fadeIn();
        $('#detailRow').fadeIn();
        $('#chartSelection').fadeIn();
    };

    if (compareDatePart) {
        toDo++;
        d3.json('/reports/api/?url=txns/salesSummary/' + grouping + '/' + compareDatePart + '&timezone=' + jstz.determine().name(), function (json) {
            if ((--toDo) == 0) {
                doneFn(mainJson, json);
            } else {
                cmpJson = json;
            }
        });
    }

    d3.json('/reports/api/?url=txns/salesSummary/' + grouping + '/' + datePart + '&timezone=' + jstz.determine().name(), function (json) {
        if ((--toDo) == 0) {
            doneFn(json, cmpJson);
        } else {
            mainJson = json;
        }
    });
}

function paymentTypeRow(tbody, json, type, displayType) {
    var sum = 0, ct = 0, rct = 0;
    json.data.tenderDetails.map(function (d) {
        if (d.tenderType === type) {
            ct += d.noOfSales;
            rct += d.noOfRefunds;
            sum += d.netCollected;
        }
    });
    if (ct > 0 || rct > 0) {
        tbody.append([
            '<tr><td>', displayType, '</td><td class="text-center"><span class="badge">', ct ? ct : '',
            '</span></td><td class="text-center"><span class="badge">', rct ? rct : '', '</span></td><td class="amount">',
            accounting.formatMoney(new BigNumber(sum).dividedBy(100)), '</td></tr>'
        ].join(''));
    }
}

function setDatePart() {
    var start = moment(), end = moment(start);
    var forcePeriod = null;
    switch (datePeriod) {
        case "ytd":
            start.startOf('year');
            break;
        case "mtd":
            start.startOf('month');
            break;
        case "wtd":
            forcePeriod = 'daily';
            start.startOf('week');
            break;
        case "last30":
            start = start.subtract(30, 'day');
            if (grouping == 'weekly') {
                start.startOf('week');
            }
            break;
        case "tod":
            forcePeriod = 'daily';
            start = start.startOf('day');
            break;
        case "yes":
            forcePeriod = 'daily';
            start = start.subtract(1, 'day').startOf('day');
            end = end.subtract(1, 'day').endOf('day');
            break;
        case "last3m":
            start.subtract(3, 'month').startOf('month');
            break;
        case "last6m":
            start.subtract(6, 'month').startOf('month');
            break;
        case "prev3":
            start.subtract(4, 'month').startOf('month');
            end.subtract(1, 'month').endOf('month');
            break;
        case "lastmonth":
            start.subtract(1, 'month').startOf('month');
            end.subtract(1, 'month').endOf('month');
            break;
    }
    dateStart = start.toDate();
    dateEnd = end.toDate();
    datePart = start.format("YYYY-MM-DD") + '/' + end.format("YYYY-MM-DD");

    var cmpMultiple = 1, cmpStart = moment(start), cmpEnd = moment(start);
    switch (compare) {
        case "4previous":
            cmpMultiple *= 2;
        case "2previous":
            cmpMultiple *= 2;
        case "previous":
            switch (datePeriod) {
                case "ytd":
                    cmpStart.subtract('year', cmpMultiple);
                    cmpEnd.subtract(1, 'day');
                    break;
                case "mtd":
                    cmpStart.subtract('month', cmpMultiple);
                    break;
                case "wtd":
                    cmpStart.subtract('week', cmpMultiple);
                    break;
                case "last30":
                    cmpStart.subtract(30 * cmpMultiple, 'day');
                    if (grouping == 'weekly') {
                        cmpStart.startOf('week');
                    }
                    break;
                case "tod":
                case "yes":
                    cmpStart.subtract(cmpMultiple, 'day');
                    break;
                case "last3m":
                case "prev3":
                case "lastmonth":
                    cmpStart.subtract(3*cmpMultiple, 'month');
                    break;
                case "last6m":
                    cmpStart.subtract(6*cmpMultiple, 'month');
                    break;
            }
            break;
        default:
            cmpStart = compareDatePart = compareStart = compareEnd = null;
            break;
    }
    if (cmpStart) {
        compareStart = cmpStart.toDate();
        compareEnd = cmpEnd.toDate();
        compareDatePart = cmpStart.format("YYYY-MM-DD") + '/' + cmpEnd.format("YYYY-MM-DD");
    }

    if (forcePeriod) {
        var l = $('#frequency li[data-value="'+forcePeriod+'"]');
        grouping = forcePeriod;
        setD3Timegroup();
        $('#groupPeriod').text(l.text());
    }
}

var ProductDataSource = function (options) {
    AjaxDataSource.call(this, function () {
        return '/reports/api/?url=productReport/snapshot/' + datePart + '&timezone=' + jstz.determine().name();
    });
    this._columns = [
        {
            property: 'safeItemName',
            label: 'Name',
            sortable: true
        },
        {
            property: 'quantity',
            label: 'Qty Sold',
            sortable: true,
            width: 100,
            className: 'text-right'
        },
        {
            property: 'salesFormatted',
            sortProperty: 'sales',
            label: 'Total Sales',
            width: 200,
            className: 'text-right'
        }
    ];
};

ProductDataSource.prototype = Object.create(AjaxDataSource.prototype);
ProductDataSource.prototype.constructor = ProductDataSource;
ProductDataSource.prototype.success = function (data, options, callback) {
    this.sourceData = data.data[0].products;
    productCsv(this.sourceData);
    this._buildResponse(options, callback);
};

ProductDataSource.prototype.formatter = function (index, item) {
    item.safeItemName = $safe(item.itemName);
    item.salesFormatted = accounting.formatMoney(new BigNumber(item.sales).dividedBy(100));
};

var productSource = new ProductDataSource();

function productCsv(rows) {
    var csv = [["Product,Quantity Sold,Total Sales"]];

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var csvRow = [
            safeCsv(row.itemName),
            row.quantity,
            new BigNumber(row.sales).dividedBy(100).toString()
        ];
        csv.push(csvRow);
    }
    var link = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv.join('\n'));
    $('#productExport').attr({
        href: link,
        download: 'appsforhere-product-report.csv'
    });
}

var EmployeeDataSource = function (options) {
    AjaxDataSource.call(this, function () {
        return '/reports/api/?url=empSalesReport/' + grouping + '/' + datePart + '&timezone=' + jstz.determine().name();
    });
    this._columns = [
        {
            property: 'sellerID',
            label: 'Name',
            sortable: true
        },
        {
            property: 'noOfSales',
            label: '# Sales',
            sortable: true,
            width: 100,
            className: 'text-right'
        },
        {
            property: 'salesFormat',
            sortProperty: 'sales',
            sortable: true,
            label: 'Total Sales',
            width: 150,
            className: 'text-right'
        },
        {
            property: 'taxFormat',
            sortProperty: 'tax',
            sortable: true,
            label: 'Taxes',
            width: 100,
            className: 'text-right'
        },
        {
            property: 'tipFormat',
            sortProperty: 'tip',
            sortable: true,
            label: 'Tips',
            width: 100,
            className: 'text-right'
        },
        {
            property: 'discountFormat',
            sortProperty: 'discount',
            sortable: true,
            label: 'Discounts',
            width: 100,
            className: 'text-right'
        },
        {
            property: 'totalCollectedFormat',
            sortProperty: 'totalCollected',
            sortable: true,
            label: 'Total Collected',
            width: 150,
            className: 'text-right'
        }
    ];
};

EmployeeDataSource.prototype = Object.create(AjaxDataSource.prototype);
EmployeeDataSource.prototype.constructor = EmployeeDataSource;
EmployeeDataSource.prototype.success = function (data, options, callback) {
    var bySeller = {};
    data.data.forEach(function (period) {
        period.salesBySeller.forEach(function (si) {
            var info = bySeller[si.sellerID];
            if (!info) {
                info = bySeller[si.sellerID] = {
                    discount: 0,
                    noOfSales: 0,
                    sales: 0,
                    sellerID: si.sellerID,
                    tax: 0,
                    tip: 0,
                    totalCollected: 0,
                    totalSales: 0
                };
            }
            info.discount += si.discount||0;
            info.noOfSales += si.noOfSales||0;
            info.sales += si.sales||0;
            info.tax += si.tax||0;
            info.tip += si.tip||0;
            info.totalCollected += si.totalCollected||0;
            info.totalSales += si.totalSales||0;
        });
    });
    this.sourceData = [];
    for (var i in bySeller) {
        bySeller[i].discountFormat = amtOrDash(bySeller[i].discount);
        bySeller[i].salesFormat = amtOrDash(bySeller[i].sales);
        bySeller[i].taxFormat = amtOrDash(bySeller[i].tax);
        bySeller[i].tipFormat = amtOrDash(bySeller[i].tip);
        bySeller[i].totalCollectedFormat = amtOrDash(bySeller[i].totalCollected);
        bySeller[i].totalSalesFormat = amtOrDash(bySeller[i].totalSales);
        this.sourceData.push(bySeller[i]);
    }
    empCsv(this.sourceData);
    this._buildResponse(options, callback);
};

EmployeeDataSource.prototype.formatter = function (index, item) {
};

var employeeSource = new EmployeeDataSource();

var safeCsv = function (x) {
    return x ? x.replace('"', '""') : '';
};

function empCsv(rows) {
    var csv = [["User,Number Of Sales,Total Sales,Tax,Tips,Total Collected"]];

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var csvRow = [
            safeCsv(row.sellerID),
            row.noOfSales,
            new BigNumber(row.totalSales).dividedBy(100).toString(),
            new BigNumber(row.tax).dividedBy(100).toString(),
            new BigNumber(row.tip).dividedBy(100).toString(),
            new BigNumber(row.totalCollected).dividedBy(100).toString()
        ];
        csv.push(csvRow);
    }
    var link = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv.join('\n'));
    $('#empExport').attr({
        'href': link,
        download: 'appsforhere-employee-report.csv'
    });
}

function chartCsv(rows) {
    var csv = ["Date,Number Of Sales,Total Sales,Tax,Tips,Total Collected,Fees,Number of Refunds,Total Refunds,Net"];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var csvRow = [
            safeCsv(row.date),
            row.noOfSales,
            new BigNumber(row.totalSales||0).dividedBy(100).toString(),
            new BigNumber(row.tax||0).dividedBy(100).toString(),
            new BigNumber(row.tips||0).dividedBy(100).toString(),
            new BigNumber(row.totalCollected||0).dividedBy(100).toString(),
            new BigNumber(row.fees||0).dividedBy(100).toString(),
            row.noOfRefunds,
            new BigNumber(row.refunds||0).dividedBy(100).toString(),
            new BigNumber(row.netCollected||0).dividedBy(100).toString(),
        ];
        csv.push(csvRow);
    }
    var link = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv.join('\n'));
    $('#summaryCsvExport').attr({
        'href': link,
        download: 'appsforhere-summary-report.csv'
    });
}

function closestPoint(pathNode, point) {
    var pathLength = pathNode.pathSegList.length,
        best,
        bestIx,
        bestDistance = Infinity;

    for (var ptIx = 0; ptIx < pathLength; ptIx++) {
        var d = distance2(pathNode.pathSegList[ptIx]);
        if (d < bestDistance) {
            best = pathNode.pathSegList[ptIx];
            bestIx = ptIx;
            bestDistance = d;
        }
    }
    return {
        x: best.x,
        y: best.y,
        ix: bestIx,
        distance: bestDistance
    };

    function distance2(p) {
        var dx = p.x - point[0],
            dy = p.y - point[1];
        return dx * dx + dy * dy;
    }
}
